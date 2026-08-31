export const evmIndexStorageKey = (chainId: number): string =>
    `chain-${chainId}`;

/**
 * Resolves the next EVM HD index to use for a chain.
 *
 * Historically the counter was stored per asset symbol while the derivation
 * path (`m/44/{chainId}/0/0/{index}`) is scoped by chainId only. Two assets on
 * the same chain therefore derived the identical key - and therefore the
 * identical swap preimage - whenever their independent counters reached the
 * same value (guaranteed for the first swap of each asset, index 0).
 *
 * The counter is now stored per chainId so every swap on a chain gets a unique
 * index. This helper also migrates existing per-asset counters: if no per-chain
 * counter exists yet it starts above the highest index any same-chain asset
 * already reached, so a returning user never reuses an index (and thus a
 * key/preimage) that a previous swap on that chain may have used.
 */
export const nextEvmIndexForChain = async (
    chainId: number,
    assetChainIds: Record<string, number | undefined>,
    getItem: (key: string) => Promise<number | null | undefined>,
): Promise<number> => {
    const existing = await getItem(evmIndexStorageKey(chainId));
    if (existing !== null && existing !== undefined) {
        return existing;
    }

    let migrated = 0;
    for (const [symbol, assetChainId] of Object.entries(assetChainIds)) {
        if (assetChainId !== chainId) {
            continue;
        }

        const perAsset = await getItem(symbol);
        if (perAsset !== null && perAsset !== undefined) {
            migrated = Math.max(migrated, perAsset);
        }
    }

    return migrated;
};
