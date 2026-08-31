import {
    evmIndexStorageKey,
    nextEvmIndexForChain,
} from "../../src/utils/evmIndex";

describe("evmIndex", () => {
    describe("evmIndexStorageKey", () => {
        test.each`
            chainId  | expected
            ${1}     | ${"chain-1"}
            ${42161} | ${"chain-42161"}
        `("keys the counter by chainId ($chainId)", ({ chainId, expected }) => {
            expect(evmIndexStorageKey(chainId as number)).toBe(expected);
        });
    });

    describe("nextEvmIndexForChain", () => {
        const makeStore =
            (data: Record<string, number>) =>
            (key: string): Promise<number | null> =>
                Promise.resolve(key in data ? data[key] : null);

        test("returns the existing per-chain counter when set", async () => {
            const getItem = makeStore({ "chain-42161": 5, TBTC: 2, USDC: 3 });
            expect(await nextEvmIndexForChain(42161, {}, getItem)).toBe(5);
        });

        test("prefers the per-chain counter over migration", async () => {
            const getItem = makeStore({ "chain-42161": 1, TBTC: 9 });
            expect(
                await nextEvmIndexForChain(42161, { TBTC: 42161 }, getItem),
            ).toBe(1);
        });

        test("returns 0 when nothing is stored", async () => {
            const getItem = makeStore({});
            expect(
                await nextEvmIndexForChain(42161, { TBTC: 42161 }, getItem),
            ).toBe(0);
        });

        test("migrates from the highest same-chain per-asset counter", async () => {
            const getItem = makeStore({ TBTC: 2, WBTC: 5, USDC: 3 });
            const assetChainIds = { TBTC: 42161, WBTC: 42161, USDC: 42161 };
            expect(
                await nextEvmIndexForChain(42161, assetChainIds, getItem),
            ).toBe(5);
        });

        test("ignores per-asset counters from other chains during migration", async () => {
            const getItem = makeStore({ TBTC: 2, "USDC-ETH": 9 });
            const assetChainIds = { TBTC: 42161, "USDC-ETH": 1 };
            expect(
                await nextEvmIndexForChain(42161, assetChainIds, getItem),
            ).toBe(2);
        });

        test("allocates unique indices across same-chain assets (no key/preimage reuse)", async () => {
            const store: Record<string, number> = {};
            const getItem = (key: string): Promise<number | null> =>
                Promise.resolve(key in store ? store[key] : null);
            const assetChainIds = { TBTC: 42161, USDC: 42161 };

            const allocate = async (chainId: number) => {
                const index = await nextEvmIndexForChain(
                    chainId,
                    assetChainIds,
                    getItem,
                );
                store[evmIndexStorageKey(chainId)] = index + 1;
                return index;
            };

            // First swap with TBTC and first swap with USDC (both on Arbitrum).
            // Previously both drew index 0 from their per-asset counters and
            // therefore shared the same key and preimage; now they differ.
            const tbtcIndex = await allocate(42161);
            const usdcIndex = await allocate(42161);

            expect(tbtcIndex).toBe(0);
            expect(usdcIndex).toBe(1);
            expect(tbtcIndex).not.toBe(usdcIndex);
        });
    });
});
