# Boltz Web App

This is the source of the satsrouting fork of the official Boltz Web App. It is now served at
[satsrouting.exchange](https://satsrouting.exchange/). It enables **non-custodial** swaps
between different Bitcoin layers: On-chain, Lightning, Liquid. Other layers are disabled at the moment.

## Documentation

We encourage our technical users to check the code and run the web app locally
from source following
[these instructions](https://docs.boltz.exchange/v/web-app/) in our docs.

## Security

**Date:** September 1, 2026
**Component:** `boltz-web-app` (client interface)
**Scope of this node:** BTC on-chain, Lightning (LND), and Liquid (L-BTC) swaps only. EVM/Rootstock/Arbitrum, Solana, Tron, ERC20/OFT and bridge/CCTP paths are not enabled on this deployment.

### Overview

Our fork of this project is intentionally scoped to **Bitcoin, Liquid Bitcoin (L-BTC), and Lightning only**. We do not maintain or operate any altcoin, EVM-family (Ethereum/Rootstock/Arbitrum), Solana, Tron, or bridge/token integrations, and we do not plan to. This deliberately narrow focus keeps the codebase we actually run smaller and easier to reason about from a security standpoint, and it shaped how the audit findings below were triaged.

Following a third-party security audit, a series of hardening fixes was reviewed, applied, and verified on the web front-end. Each finding from the audit was triaged into one of three buckets:

- **Active and relevant** — touches code paths we actually exercise in production (rescue-file handling, logging, timeout/amount sanity checks, Lightning/BOLT12 address resolution, dependency pinning).
- **Defensive** — correct and merged, but only exercised on a Liquid edge case (sending a Liquid asset other than L-BTC) that is not part of normal usage today.
- **Not applicable** — code paths tied to chains we do not run (EVM-family / Alchemy / gas-abstraction, Rootstock/RIF, ERC20/OFT bridges). Left in place for upstream compatibility but inert in our context.

Roughly eight fixes fell into the active/relevant category, one was defensive, and a further five were confirmed out of scope and required no action beyond review.

### What was hardened

Without going into implementation-level detail, the web-app fixes cluster around the following themes:

- **Client-side recovery data.** The local "rescue file" (used to recover a swap independently of our infrastructure) can now optionally be encrypted at rest in the browser, protecting it if the device or browser storage is later compromised.
- **Secrets and logging hygiene.** Private keys, mnemonics, seeds, and payment preimages are now redacted from persisted logs and diagnostic exports, rather than being written in the clear.
- **Amount and timeout sanity checks.** The client now independently sanity-checks the lockup timeout the server proposes for BTC/Liquid swaps against the current chain tip, failing open (i.e. not blocking a legitimate swap) if that check can't be performed, rather than trusting the server value unconditionally.
- **Rescue and chain-swap robustness.** Restored chain-swap rescue data is now validated for internal consistency (public key correspondence) before being trusted, and the signing flow used during external asset-rescue was tightened so the client independently re-derives and validates what it is being asked to sign, rather than trusting the server's message at face value.
- **Address and payment resolution.** Lightning address resolution now prefers a DNSSEC-backed method (BIP-353) over the legacy LNURL lookup when both are available, and BIP21/BOLT12 addresses are cryptographically verified before a payment is upgraded to an on-chain flow, with a safe fallback to the standard flow if verification fails or is absent.
- **Dependency hygiene.** A Lightning/BOLT12-related library was pinned to a known-good exact version to avoid unintended upstream changes.
- **Test coverage.** Automated tests were added for the refund-guard and asset-rescue signing logic described above.

One fix is classed as *defensive*: it applies to a Liquid asset-rescue signing path that only activates when a Liquid asset other than L-BTC is involved, and is now covered by automated tests in case that path is ever exercised.

A handful of upstream fixes — covering EVM chain-ID binding, exact ERC20 approval amounts for bridge contracts, Rootstock relay fee caps, and windowed preimage derivation for EVM rescue — were reviewed and confirmed **not applicable** to this deployment, since we run no EVM/Rootstock integrations.

### Verification

- All fixes applicable to our configuration were exercised on the live node: submarine, reverse, and chain swaps across BTC, Lightning, and Liquid; a full external "disaster recovery" rescue from a clean browser session using only the exported rescue file and the server; encryption/unlock of the rescue file; swap-ID generation observed in production; and Lightning-address resolution behavior observed in real network traffic.
- New automated tests were added covering the refund-state logic and the Liquid rescue-signing guard, alongside the existing test suites, all of which pass with no regressions.
- One protocol-level scenario (a failed reverse swap settling via Lightning's own HTLC timeout) was intentionally not drilled live, since it is governed by the Lightning protocol itself rather than by code we changed, and would only require waiting out a timelock to observe.

### Operational notes

- EVM/Rootstock/Arbitrum integrations remain disabled, consistent with our BTC/LN/Liquid-only scope.

### Conclusion

All audit findings relevant to our operational scope (BTC on-chain, Lightning/LND, Liquid L-BTC) have been applied and verified through both live testing and automated test coverage. 

## Resources

- Read the Docs: [Docs Home](https://docs.boltz.exchange/)
- Read our Blog: [Substack](https://blog.boltz.exchange/)
- Open a Lightning channel with us:
  [LND](https://amboss.space/node/0317235909659a67918dde7786b4986319c68165b72893877e0ff64a973bc62395)
