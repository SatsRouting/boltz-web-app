import { SwapType } from "boltz-swaps/types";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { refundUtxos } from "../../packages/boltz-swaps/src/utxo/index.ts";
import { BTC, LBTC } from "../../src/consts/Assets";
import { broadcastTransaction } from "../../src/utils/blockchain";
import { getFeeEstimationsFailover } from "../../src/utils/fees";
import type * as HelperModule from "../../src/utils/helper";
import { RefundType, refund } from "../../src/utils/rescue";
import type { SubmarineSwap } from "../../src/utils/swapCreator";

// Covers the web-app refund orchestration around the SDK `refundUtxos`
// primitive: the cooperative/uncooperative flag mapping, the nLockTime derived
// from the lockup timeout, and the "non-final" broadcast fallback that surfaces
// the cooperative error when the timelocked (uncooperative) transaction cannot
// be broadcast yet. The uncooperative path is the trustless escape hatch that
// must keep working even if Boltz refuses to co-sign.

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
    parseBlindingKey: vi.fn(() => undefined),
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

vi.mock("../../packages/boltz-swaps/src/utxo/index.ts", () => ({
    createMusig: vi.fn(),
    tweakMusig: vi.fn(),
    hashForWitnessV1: vi.fn(),
    decodeAddress: vi.fn(),
    getNetwork: vi.fn(),
    getTransaction: vi.fn(() => ({ fromHex: () => ({}) })),
    txToId: vi.fn(),
    refundUtxos: vi.fn(),
}));

const timeoutBlockHeight = 150;

const swap = {
    id: "refundSwap",
    type: SwapType.Submarine,
    assetSend: LBTC,
    assetReceive: "BTC",
    claimPublicKey: `02${"ab".repeat(32)}`,
    swapTree: {} as never,
    refundPrivateKey: "01".repeat(32),
    refundPrivateKeyIndex: 0,
} as unknown as SubmarineSwap;

const refundAddress = "lq1testrefundaddress";
const deriveKey = vi.fn();

const callRefund = (type: RefundType, asset = LBTC) =>
    refund(
        deriveKey,
        { ...swap, assetSend: asset } as SubmarineSwap,
        refundAddress,
        [{ hex: "00", timeoutBlockHeight }],
        type,
    );

describe("refund (cooperative / uncooperative UTXO paths)", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(getFeeEstimationsFailover).mockResolvedValue(2 as never);
        vi.mocked(refundUtxos).mockResolvedValue({
            transactionHex: "refundhex",
            transactionId: "refundid",
        } as never);
        vi.mocked(broadcastTransaction).mockResolvedValue({
            id: "broadcast-id",
        } as never);
    });

    test("cooperative refund asks the SDK to co-sign and broadcasts the result", async () => {
        const result = await callRefund(RefundType.Cooperative);

        expect(result).toBe("broadcast-id");
        expect(refundUtxos).toHaveBeenCalledTimes(1);
        const params = vi.mocked(refundUtxos).mock.calls[0][0];
        expect(params.cooperative).toBe(true);
        expect(params.asset).toBe(LBTC);
        expect(params.refundAddress).toBe(refundAddress);
        expect(params.feePerVbyte).toBe(2);
        expect(params.nLockTime).toBe(timeoutBlockHeight);
        expect(params.lockups[0].timeoutBlockHeight).toBe(timeoutBlockHeight);
        expect(broadcastTransaction).toHaveBeenCalledWith(LBTC, "refundhex");
    });

    test("uncooperative refund builds a timelocked transaction without co-signing", async () => {
        const result = await callRefund(RefundType.Uncooperative, BTC);

        expect(result).toBe("broadcast-id");
        const params = vi.mocked(refundUtxos).mock.calls[0][0];
        expect(params.cooperative).toBe(false);
        expect(params.asset).toBe(BTC);
        expect(params.nLockTime).toBe(timeoutBlockHeight);
        expect(broadcastTransaction).toHaveBeenCalledWith(BTC, "refundhex");
    });

    test("surfaces the cooperative error when a non-final timelocked refund cannot be broadcast yet", async () => {
        const cooperativeError = new Error("cooperative refund rejected");
        vi.mocked(refundUtxos).mockResolvedValue({
            transactionHex: "refundhex",
            transactionId: "refundid",
            cooperativeError,
        } as never);
        vi.mocked(broadcastTransaction).mockRejectedValue("non-final");

        await expect(callRefund(RefundType.Uncooperative)).rejects.toThrow(
            /cooperative refund rejected/,
        );
    });

    test("propagates a plain broadcast error when there is no cooperative error", async () => {
        vi.mocked(broadcastTransaction).mockRejectedValue("non-final");

        await expect(callRefund(RefundType.Uncooperative)).rejects.toBe(
            "non-final",
        );
    });
});
