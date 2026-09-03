import { sha256 } from "@noble/hashes/sha2.js";
import { hex } from "@scure/base";
import type { HDKey } from "@scure/bip32";

import {
    derivePreimage,
    evmPath,
    mnemonicToHDKey,
} from "../../utils/rescueDerivation";
import { derivationWindow, maxIterations } from "./constants";

const batchSize = 1_000;

export type PreimageHashEntry = [string, { preimage: string; index: number }];

export type PreimageHashMessage = {
    entries: PreimageHashEntry[];
    done: boolean;
    // The worker finished a window and is waiting for a `{ continue: true }`
    // message before deriving further. Never set together with `done`.
    paused: boolean;
};

type StartMessage = { mnemonic: string; chainId: number };
type ContinueMessage = { continue: true };

let parentKey: HDKey | null = null;
let nextIndex = 0;

const deriveNextWindow = () => {
    if (parentKey === null) {
        return;
    }

    const windowEnd = Math.min(nextIndex + derivationWindow, maxIterations);
    let entries: PreimageHashEntry[] = [];

    for (let i = nextIndex; i < windowEnd; i++) {
        const privateKey = parentKey.deriveChild(i).privateKey;
        if (privateKey === null) {
            continue;
        }
        const preimage = derivePreimage(privateKey);

        entries.push([
            hex.encode(sha256(preimage)),
            { preimage: hex.encode(preimage), index: i },
        ]);

        if (entries.length >= batchSize) {
            self.postMessage({ entries, done: false, paused: false });
            entries = [];
        }
    }

    nextIndex = windowEnd;
    const done = nextIndex >= maxIterations;

    // Final message of the window: pause (await a continue request) unless the
    // absolute ceiling has been reached, so the worker never derives further
    // than the scanner actually needs.
    self.postMessage({ entries, done, paused: !done });
};

self.onmessage = ({
    data,
}: MessageEvent<StartMessage | ContinueMessage>) => {
    if ("mnemonic" in data) {
        parentKey = mnemonicToHDKey(data.mnemonic).derive(evmPath(data.chainId));
        nextIndex = 0;
    }

    deriveNextWindow();
};
