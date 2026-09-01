import { prefix0x, satoshiToWei } from "boltz-swaps/evm";
import type { EtherSwapContract } from "boltz-swaps/evm/contracts";
import { etherSwapAbi } from "boltz-swaps/generated/evm-abis";
import log from "loglevel";
import {
    type Address,
    encodeFunctionData,
    getAddress,
    zeroAddress,
} from "viem";

import type { Signer } from "../context/Web3";
import { estimateFeesPerGas } from "../utils/provider";
import {
    getForwarder,
    getRifDeployVerifierAddress,
    getSmartWalletFactory,
} from "./Contracts";
import { type Metadata, estimate, getChainInfo, relay } from "./Relay";
import { calculateGasPrice, getValidUntilTime, isDeployRequest } from "./Utils";
import {
    type EnvelopingRequest,
    deployRequestType,
    getEnvelopingRequestDataV4Field,
    relayRequestType,
} from "./types/TypedRequestData";

// With some extra buffer; just in case
export const GasNeededToClaim = BigInt(35355) * 2n;

export const MaxRelayNonceGap = 10;

// Generous slack over the bare gas cost to tolerate relay margin and estimation
// variance while still rejecting a fee inflated to drain the claim.
export const rifFeePremium = 3n;

// Largest relay fee (in wei) the client will authorize for a claim, given the
// gas the relay says it needs and a trustworthy gas price. Exported for tests.
export const maxAcceptableRelayFee = (
    tokenGas: bigint,
    effectiveGasPrice: bigint,
): bigint => tokenGas * effectiveGasPrice * rifFeePremium;

const sign = async (signer: Signer, request: EnvelopingRequest) => {
    const chainId = BigInt(await signer.provider.getChainId());
    const callForwarder = request.relayData.callForwarder;
    if (typeof callForwarder !== "string") {
        throw new Error("missing RIF call forwarder");
    }

    const data = getEnvelopingRequestDataV4Field({
        chainId: Number(chainId),
        envelopingRequest: request,
        verifier: getAddress(callForwarder),
        requestTypes: isDeployRequest(request)
            ? deployRequestType
            : relayRequestType,
    });

    return signer.signTypedData({
        account: signer.account,
        domain: data.domain,
        types: data.types,
        primaryType: data.primaryType,
        message: data.value,
    });
};

export const relayClaimTransaction = async (
    signer: Signer,
    etherSwap: EtherSwapContract,
    preimage: string,
    amount: number | bigint,
    refundAddress: Address,
    timeoutBlockHeight: number | bigint,
) => {
    const callData = encodeFunctionData({
        abi: etherSwapAbi,
        functionName: "claim",
        args: [
            prefix0x(preimage),
            satoshiToWei(amount),
            getAddress(refundAddress),
            BigInt(timeoutBlockHeight),
        ],
    });
    const etherSwapAddress = etherSwap.address;
    const signerAddress = signer.address;
    const [chainInfo, smartWalletAddress, feeData] = await Promise.all([
        getChainInfo(),
        getSmartWalletAddress(signer),
        estimateFeesPerGas(signer.provider),
    ]);

    // viem's `getCode` returns `undefined` (not "0x") when the address has no
    // code, so `!== "0x"` alone would falsely report every first-time user as
    // having a deployed smart wallet. Treat both as "no code".
    const smartWalletCode = await signer.provider.getCode({
        address: getAddress(smartWalletAddress.address),
    });
    const smartWalletExists =
        smartWalletCode !== undefined && smartWalletCode !== "0x";
    log.info("RIF smart wallet exists:", smartWalletExists);

    const smartWalletFactory = getSmartWalletFactory(signer);

    const envelopingRequest: EnvelopingRequest = {
        request: {
            value: "0",
            data: callData,
            tokenAmount: "0",
            tokenGas: "20000",
            from: signerAddress,
            to: etherSwapAddress,
            tokenContract: zeroAddress,
            relayHub: chainInfo.relayHubAddress,
            validUntilTime: getValidUntilTime(),
        },
        relayData: {
            feesReceiver: chainInfo.feesReceiver,
            callVerifier: getRifDeployVerifierAddress(),
            gasPrice: calculateGasPrice(
                feeData.gasPrice ?? 0n,
                chainInfo.minGasPrice,
            ).toString(),
        },
    };

    if (!smartWalletExists) {
        envelopingRequest.request.recoverer = zeroAddress;
        envelopingRequest.request.index = Number(smartWalletAddress.nonce);
        envelopingRequest.request.nonce = (
            await smartWalletFactory.read.nonce([signerAddress])
        ).toString();

        envelopingRequest.relayData.callForwarder = smartWalletFactory.address;
    } else {
        envelopingRequest.request.gas = GasNeededToClaim.toString();
        envelopingRequest.request.nonce = (
            await getForwarder(signer, smartWalletAddress.address).read.nonce()
        ).toString();

        envelopingRequest.relayData.callForwarder = smartWalletAddress.address;
    }

    const metadata: Metadata = {
        signature: "SERVER_SIGNATURE_REQUIRED",
        relayHubAddress: chainInfo.relayHubAddress,
        relayMaxNonce:
            (await signer.provider.getTransactionCount({
                address: getAddress(chainInfo.relayWorkerAddress),
            })) + MaxRelayNonceGap,
    };

    const estimateRes = await estimate(envelopingRequest, metadata);
    log.debug("RIF gas estimation response", estimateRes);

    // The smart wallet pays `tokenAmount` of native RBTC to the relay's
    // feesReceiver, and this signed request is the sole authorization for that
    // payment. Bound the relay-chosen fee before signing so a malicious or
    // compromised relay cannot make the user authorize (almost) their entire
    // claimed amount as a "fee".
    const tokenGas = BigInt(estimateRes.estimation);
    const tokenAmount = BigInt(estimateRes.requiredTokenAmount);
    const signedGasPrice = calculateGasPrice(
        feeData.gasPrice ?? 0n,
        chainInfo.minGasPrice,
    );
    // Reference against the client's own network gas price so a manipulated
    // server `minGasPrice` cannot inflate the ceiling; fall back to the signed
    // price only when the provider estimate is unavailable.
    const referenceGasPrice =
        feeData.gasPrice !== undefined && feeData.gasPrice > 0n
            ? feeData.gasPrice
            : signedGasPrice;
    const effectiveGasPrice =
        signedGasPrice < referenceGasPrice ? signedGasPrice : referenceGasPrice;
    const maxRelayFee = maxAcceptableRelayFee(tokenGas, effectiveGasPrice);
    const claimWei = satoshiToWei(amount);

    if (tokenAmount > maxRelayFee || tokenAmount >= claimWei) {
        throw new Error(
            `RIF relay requested fee ${tokenAmount.toString()} wei exceeds the accepted maximum ${maxRelayFee.toString()} wei (gas ${tokenGas.toString()}, claim ${claimWei.toString()} wei); refusing to sign`,
        );
    }

    envelopingRequest.request.tokenGas = estimateRes.estimation;
    envelopingRequest.request.tokenAmount = estimateRes.requiredTokenAmount;
    metadata.signature = await sign(signer, envelopingRequest);

    const relayRes = await relay(envelopingRequest, metadata);
    return relayRes.txHash;
};

export const getSmartWalletAddress = async (
    signer: Signer,
): Promise<{
    nonce: bigint;
    address: string;
}> => {
    const factory = getSmartWalletFactory(signer);

    const nonce = await factory.read.nonce([signer.address]);
    const smartWalletAddress: string = await factory.read.getSmartWalletAddress(
        [signer.address, zeroAddress, nonce],
    );
    log.debug(
        `RIF smart wallet address ${smartWalletAddress} with nonce ${nonce}`,
    );
    return {
        nonce,
        address: smartWalletAddress,
    };
};
