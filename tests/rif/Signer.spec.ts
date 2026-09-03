import { maxAcceptableRelayFee, rifFeePremium } from "../../src/rif/Signer";

describe("maxAcceptableRelayFee", () => {
    test("bounds the fee to the gas cost times the premium", () => {
        const tokenGas = 35_000n;
        const gasPrice = 60_000_000n; // ~0.06 gwei, typical for Rootstock

        expect(maxAcceptableRelayFee(tokenGas, gasPrice)).toBe(
            tokenGas * gasPrice * rifFeePremium,
        );
    });

    test("a fair relay fee stays under the bound while a drain attempt exceeds it", () => {
        const tokenGas = 35_000n;
        const gasPrice = 60_000_000n;
        const bound = maxAcceptableRelayFee(tokenGas, gasPrice);

        // Honest fee is roughly the bare gas cost.
        const fairFee = tokenGas * gasPrice;
        expect(fairFee <= bound).toBe(true);

        // A relay trying to skim (near) the whole claimed amount is far above it.
        const claimWei = 10n ** 18n; // 1 RBTC
        expect(claimWei > bound).toBe(true);
    });

    test("returns zero when the gas price is unknown (rejects any positive fee)", () => {
        expect(maxAcceptableRelayFee(35_000n, 0n)).toBe(0n);
    });
});
