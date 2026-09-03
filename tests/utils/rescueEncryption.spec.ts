import {
    type ScryptParams,
    InvalidPassphraseError,
    decryptMnemonic,
    encryptMnemonic,
    isEncryptedRescueFile,
} from "../../src/utils/rescueEncryption";

describe("rescueEncryption", () => {
    const mnemonic =
        "invite smile evidence shield frost source truly ball odor unfold example nuclear";
    const passphrase = "correct horse battery staple";

    // Low-cost KDF params keep the tests fast; production uses the strong
    // defaults. The params are stored in the blob so decryption is unaffected.
    const testParams: ScryptParams = { n: 2 ** 8, r: 8, p: 1 };

    describe("encryptMnemonic / decryptMnemonic", () => {
        test("round-trips the mnemonic with the correct passphrase", async () => {
            const encrypted = await encryptMnemonic(
                mnemonic,
                passphrase,
                testParams,
            );

            expect(encrypted.ciphertext).not.toContain(mnemonic);
            expect(await decryptMnemonic(encrypted, passphrase)).toBe(mnemonic);
        });

        test("produces a fresh salt and iv on every call", async () => {
            const a = await encryptMnemonic(mnemonic, passphrase, testParams);
            const b = await encryptMnemonic(mnemonic, passphrase, testParams);

            expect(a.salt).not.toBe(b.salt);
            expect(a.iv).not.toBe(b.iv);
            expect(a.ciphertext).not.toBe(b.ciphertext);
        });

        test("throws InvalidPassphraseError for a wrong passphrase", async () => {
            const encrypted = await encryptMnemonic(
                mnemonic,
                passphrase,
                testParams,
            );

            await expect(
                decryptMnemonic(encrypted, "wrong passphrase"),
            ).rejects.toBeInstanceOf(InvalidPassphraseError);
        });

        test("throws InvalidPassphraseError when the ciphertext was tampered", async () => {
            const encrypted = await encryptMnemonic(
                mnemonic,
                passphrase,
                testParams,
            );
            const flippedByte = encrypted.ciphertext.slice(0, -2) + "00";

            await expect(
                decryptMnemonic(
                    { ...encrypted, ciphertext: flippedByte },
                    passphrase,
                ),
            ).rejects.toBeInstanceOf(InvalidPassphraseError);
        });

        test("rejects an empty passphrase on encryption", async () => {
            await expect(
                encryptMnemonic(mnemonic, "", testParams),
            ).rejects.toThrow("passphrase must not be empty");
        });
    });

    describe("isEncryptedRescueFile", () => {
        test("recognises an encrypted rescue file", async () => {
            const encrypted = await encryptMnemonic(
                mnemonic,
                passphrase,
                testParams,
            );
            expect(isEncryptedRescueFile(encrypted)).toBe(true);
        });

        test("rejects a plaintext rescue file and other values", () => {
            expect(isEncryptedRescueFile({ mnemonic })).toBe(false);
            expect(isEncryptedRescueFile(null)).toBe(false);
            expect(isEncryptedRescueFile(undefined)).toBe(false);
            expect(isEncryptedRescueFile("string")).toBe(false);
            expect(isEncryptedRescueFile({ kdf: "scrypt" })).toBe(false);
        });
    });
});
