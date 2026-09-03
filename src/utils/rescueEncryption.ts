import { scryptAsync } from "@noble/hashes/scrypt.js";
import { hex } from "@scure/base";

export const RESCUE_ENCRYPTION_VERSION = 1;

export type ScryptParams = {
    n: number;
    r: number;
    p: number;
};

export type EncryptedRescueFile = {
    version: number;
    kdf: "scrypt";
    n: number;
    r: number;
    p: number;
    salt: string;
    iv: string;
    ciphertext: string;
};

// Cost parameters for the passphrase KDF. Strong enough to make offline
// brute-forcing of a stolen localStorage blob expensive, while still tolerable
// on mobile. The parameters are stored alongside the ciphertext so they can be
// tuned in the future without breaking existing blobs.
export const defaultScryptParams: ScryptParams = {
    n: 2 ** 16,
    r: 8,
    p: 1,
};

const derivedKeyLength = 32;
const saltLength = 16;
const ivLength = 12;

export class InvalidPassphraseError extends Error {
    constructor() {
        super("invalid passphrase");
        this.name = "InvalidPassphraseError";
    }
}

const getSubtle = (): SubtleCrypto => {
    const subtle = globalThis.crypto?.subtle;
    if (subtle === undefined) {
        throw new Error("WebCrypto is not available in this environment");
    }
    return subtle;
};

const deriveAesKey = async (
    passphrase: string,
    salt: Uint8Array,
    params: ScryptParams,
): Promise<CryptoKey> => {
    const keyMaterial = await scryptAsync(
        new TextEncoder().encode(passphrase.normalize("NFKC")),
        salt,
        {
            N: params.n,
            r: params.r,
            p: params.p,
            dkLen: derivedKeyLength,
        },
    );

    return getSubtle().importKey("raw", keyMaterial, "AES-GCM", false, [
        "encrypt",
        "decrypt",
    ]);
};

export const encryptMnemonic = async (
    mnemonic: string,
    passphrase: string,
    params: ScryptParams = defaultScryptParams,
): Promise<EncryptedRescueFile> => {
    if (passphrase.length === 0) {
        throw new Error("passphrase must not be empty");
    }

    const salt = crypto.getRandomValues(new Uint8Array(saltLength));
    const iv = crypto.getRandomValues(new Uint8Array(ivLength));
    const key = await deriveAesKey(passphrase, salt, params);

    const ciphertext = new Uint8Array(
        await getSubtle().encrypt(
            { name: "AES-GCM", iv },
            key,
            new TextEncoder().encode(mnemonic),
        ),
    );

    return {
        version: RESCUE_ENCRYPTION_VERSION,
        kdf: "scrypt",
        n: params.n,
        r: params.r,
        p: params.p,
        salt: hex.encode(salt),
        iv: hex.encode(iv),
        ciphertext: hex.encode(ciphertext),
    };
};

export const decryptMnemonic = async (
    encrypted: EncryptedRescueFile,
    passphrase: string,
): Promise<string> => {
    const key = await deriveAesKey(passphrase, hex.decode(encrypted.salt), {
        n: encrypted.n,
        r: encrypted.r,
        p: encrypted.p,
    });

    let plaintext: ArrayBuffer;
    try {
        plaintext = await getSubtle().decrypt(
            // Copy into fresh ArrayBuffer-backed views for WebCrypto's
            // BufferSource typing.
            { name: "AES-GCM", iv: Uint8Array.from(hex.decode(encrypted.iv)) },
            key,
            Uint8Array.from(hex.decode(encrypted.ciphertext)),
        );
    } catch {
        // AES-GCM authentication failed: wrong passphrase or tampered blob.
        throw new InvalidPassphraseError();
    }

    return new TextDecoder().decode(new Uint8Array(plaintext));
};

export const isEncryptedRescueFile = (
    value: unknown,
): value is EncryptedRescueFile => {
    if (value === null || typeof value !== "object") {
        return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
        candidate.kdf === "scrypt" &&
        typeof candidate.version === "number" &&
        typeof candidate.n === "number" &&
        typeof candidate.r === "number" &&
        typeof candidate.p === "number" &&
        typeof candidate.salt === "string" &&
        typeof candidate.iv === "string" &&
        typeof candidate.ciphertext === "string"
    );
};
