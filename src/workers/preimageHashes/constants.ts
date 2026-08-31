// Number of key indices derived per window before the worker pauses and waits
// for the scanner to ask for more. The scanner only asks while it still has
// unmatched claim candidates, so the common case derives just the first window.
export const derivationWindow = 100_000;

// Absolute ceiling across all windows. Bounds work when unmatched lockups can
// never be matched (e.g. they belong to a different wallet) so the scan cannot
// derive forever. Raised well above the historical single-pass cap so swaps
// with a key index beyond the first window are no longer invisible (FND-004).
export const maxIterations = 1_000_000;
