import { hex } from "@scure/base";
import type * as BoltzCoreModule from "boltz-core";
import { SwapTreeSerializer, detectSwap } from "boltz-core";
import { SwapType } from "boltz-swaps/types";
import { Buffer } from "buffer";
import { Transaction as LiquidTransaction } from "liquidjs-lib";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
    assetRescueBroadcast,
    assetRescueSetup,
} from "../../packages/boltz-swaps/src/client.ts";
import {
    createMusig,
    decodeAddress,
    getNetwork,
    getTransaction,
    hashForWitnessV1,
    tweakMusig,
    txToId,
} from "../../packages/boltz-swaps/src/utxo/index.ts";
import { LBTC } from "../../src/consts/Assets";
import type * as HelperModule from "../../src/utils/helper";
import { RefundType, refund } from "../../src/utils/rescue";
import type { SubmarineSwap } from "../../src/utils/swapCreator";

// SIG-002 lives in the asset-rescue signing path of `refund`. It recomputes the
// taproot key-path sighash of the rescue transaction the server returns and
// refuses to sign unless (a) that sighash byte-matches the MuSig2 `message` the
// server asked us to sign and (b) the transaction actually pays the user's
// refund address. These tests exercise both guards plus the happy path by
// mocking the surrounding crypto/network primitives and driving the guard
// clauses directly.

const dummyKeys = {
    privateKey: new Uint8Array(32).fill(1),
    publicKey: new Uint8Array(33).fill(2),
};

vi.mock("loglevel", () => ({
    default: {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        log: vi.fn(),
        getLevel: vi.fn(() => 5),
        levels: { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4, SILENT: 5 },
    },
}));

vi.mock("../../src/utils/helper", async (importActual) => ({
    ...(await importActual<typeof HelperModule>()),
    parsePrivateKey: vi.fn(() => dummyKeys),
}));

vi.mock("../../src/utils/fees", () => ({
    getFeeEstimationsFailover: vi.fn(),
}));

vi.mock("../../src/utils/blockchain", () => ({
    broadcastTransaction: vi.fn(),
    getBlockTipHeight: vi.fn(),
    getSwapUTXOs: vi.fn(),
    blockTimeMinutes: {},
}));

vi.mock("../../packages/boltz-swaps/src/client.ts", () => ({
    getLockupTransaction: vi.fn(),
    assetRescueSetup: vi.fn(),
    assetRescueBroadcast: vi.fn(),
}));

vi.mock("../../packages/boltz-swaps/src/utxo/index.ts", () => ({
    createMusig: vi.fn(),
    tweakMusig: vi.fn(),
    hashForWitnessV1: vi.fn(),
    decodeAddress: vi.fn(),
    getNetwork: vi.fn(),
    getTransaction: vi.fn(),
    txToId: vi.fn(),
    refundUtxos: vi.fn(),
}));

vi.mock("boltz-core", async (importActual) => {
    const actual = await importActual<typeof BoltzCoreModule>();
    return {
        ...actual,
        detectSwap: vi.fn(),
        SwapTreeSerializer: {
            ...actual.SwapTreeSerializer,
            deserializeSwapTree: vi.fn(),
        },
    };
});

const boltzPublicKeyHex = `02${"ab".repeat(32)}`;
const refundScript = Buffer.from(
    "00147a1b2c3d4e5f60718293a4b5c6d7e8f901234567",
    "hex",
);
const sighash = new Uint8Array(32).fill(7);

const buildRescueTx = (outputScripts: Uint8Array[], inputCount = 1) => {
    const tx = new LiquidTransaction();
    for (let i = 0; i < inputCount; i++) {
        tx.ins.push({} as never);
    }
    for (const script of outputScripts) {
        tx.outs.push({ script: Buffer.from(script) } as never);
    }
    return tx;
};

const makeMusigStub = () => {
    const session = {
        signPartial: vi.fn(() => ({
            ourPartialSignature: new Uint8Array([0x0c, 0x0d]),
        })),
    };
    const aggNonces = { initializeSession: vi.fn(() => session) };
    const withNonce = {
        publicNonce: new Uint8Array([0x0a, 0x0b]),
        aggregateNonces: vi.fn(() => aggNonces),
    };
    const withMsg = { generateNonce: vi.fn(() => withNonce) };
    return {
        aggPubkey: new Uint8Array([0x99]),
        message: vi.fn(() => withMsg),
        publicNonce: withNonce.publicNonce,
    };
};

const swap = {
    id: "assetRescueSwap",
    type: SwapType.Submarine,
    assetSend: LBTC,
    assetReceive: "BTC",
    claimPublicKey: boltzPublicKeyHex,
    swapTree: {} as never,
    refundPrivateKey: "01".repeat(32),
    refundPrivateKeyIndex: 0,
} as unknown as SubmarineSwap;

const refundAddress = "lq1testrefundaddress";
const deriveKey = vi.fn();

let rescueTx: LiquidTransaction;
let serverMessageHex: string;
let musig: ReturnType<typeof makeMusigStub>;

const callRefund = () =>
    refund(deriveKey, swap, refundAddress, [{ hex: "00" }], RefundType.AssetRescue);

describe("asset rescue signing (SIG-002)", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        rescueTx = buildRescueTx([refundScript]);
        serverMessageHex = hex.encode(sighash);
        musig = makeMusigStub();

        vi.mocked(getTransaction).mockReturnValue({
            fromHex: () => rescueTx,
        } as never);
        vi.mocked(detectSwap).mockReturnValue({ vout: 0 } as never);
        vi.mocked(txToId).mockReturnValue("lockup-txid");
        vi.mocked(createMusig).mockReturnValue({} as never);
        vi.mocked(tweakMusig).mockReturnValue(musig as never);
        vi.mocked(SwapTreeSerializer.deserializeSwapTree).mockReturnValue({
            tree: {},
        } as never);
        vi.mocked(getNetwork).mockReturnValue({} as never);
        vi.mocked(hashForWitnessV1).mockReturnValue(sighash as never);
        vi.mocked(decodeAddress).mockReturnValue({
            script: refundScript,
        } as never);
        vi.mocked(assetRescueSetup).mockImplementation(
            () =>
                Promise.resolve({
                    transaction: "00",
                    musig: {
                        message: serverMessageHex,
                        pubNonce: hex.encode(new Uint8Array([0x01, 0x02, 0x03])),
                    },
                }) as never,
        );
        vi.mocked(assetRescueBroadcast).mockResolvedValue({
            transactionId: "rescue-broadcast-id",
        } as never);
    });

    test("signs and broadcasts when the message and refund output match", async () => {
        const result = await callRefund();

        expect(result).toBe("rescue-broadcast-id");
        expect(assetRescueBroadcast).toHaveBeenCalledTimes(1);
        expect(assetRescueBroadcast).toHaveBeenCalledWith(
            LBTC,
            swap.id,
            musig.publicNonce,
            new Uint8Array([0x0c, 0x0d]),
        );
    });

    test("refuses to sign when the server message does not match the recomputed sighash", async () => {
        serverMessageHex = hex.encode(new Uint8Array(32).fill(9));

        await expect(callRefund()).rejects.toThrow(
            /message does not match the returned transaction/,
        );
        expect(assetRescueBroadcast).not.toHaveBeenCalled();
    });

    test("refuses to sign when the rescue transaction does not pay the refund address", async () => {
        rescueTx = buildRescueTx([new Uint8Array([0xde, 0xad, 0xbe, 0xef])]);

        await expect(callRefund()).rejects.toThrow(
            /does not pay the refund address/,
        );
        expect(assetRescueBroadcast).not.toHaveBeenCalled();
    });

    test("refuses to sign a rescue transaction that does not spend exactly one input", async () => {
        rescueTx = buildRescueTx([refundScript], 2);

        await expect(callRefund()).rejects.toThrow(
            /expected exactly one input/,
        );
        expect(assetRescueBroadcast).not.toHaveBeenCalled();
    });
});
