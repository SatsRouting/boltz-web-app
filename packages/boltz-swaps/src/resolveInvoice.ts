import { fetchBolt12Invoice } from "./client.ts";
import { isLnurlAmountError } from "./errors.ts";
import {
    InvoiceType,
    decodeInvoice,
    isBolt12Offer,
    isInvoice,
    validateInvoiceForOffer,
} from "./invoice.ts";
import { fetchLnurl, isLnurl, stripLightningPrefix } from "./lnurl.ts";
import type { FetchOptions } from "./types.ts";

export type ResolveInvoiceResult = { invoice: string; type: InvoiceType };

export type ResolveInvoiceOptions = FetchOptions & {
    dnsOverHttps?: string;
};

// Resolves any Lightning destination (BOLT12 offer, LNURL, Lightning address,
// BIP-353 name, or a plain BOLT11/BOLT12 invoice) into a payable invoice for
// the given amount.
export const resolveInvoice = async (
    param: string,
    amountSat: number,
    opts?: ResolveInvoiceOptions,
): Promise<ResolveInvoiceResult> => {
    const p = stripLightningPrefix(param.trim());

    if (isBolt12Offer(p)) {
        const { invoice } = await fetchBolt12Invoice(p, amountSat, {
            signal: opts?.signal,
            timeoutMs: opts?.timeoutMs,
        });
        validateInvoiceForOffer(p, invoice);
        return { invoice, type: InvoiceType.Bolt12 };
    }

    // A Lightning address may be either an LNURL-pay host or a BIP-353 name.
    // BIP-353 is authenticated by a locally verified DNSSEC proof, whereas LNURL
    // authenticity rests only on TLS to the (often third-party) host. Prefer the
    // DNSSEC-verified BIP-353 result whenever it resolves and only fall back to
    // LNURL when BIP-353 fails. Both are attempted concurrently for latency, but
    // an LNURL result (or a fast LNURL amount error) never wins over, nor aborts,
    // a still-pending BIP-353 lookup (FND-001).
    if (p.includes("@") && isLnurl(p)) {
        const raceController = new AbortController();
        const signal =
            opts?.signal != null
                ? AbortSignal.any([raceController.signal, opts.signal])
                : raceController.signal;
        try {
            const bip353Promise = import("./dnssec/bip353.ts").then((m) =>
                m.fetchBip353(p, amountSat, {
                    dnsOverHttps: opts?.dnsOverHttps,
                    signal,
                    timeoutMs: opts?.timeoutMs,
                }),
            );
            // Settle-wrap LNURL so its rejection is never unhandled and can
            // neither short-circuit nor abort the preferred BIP-353 leg.
            const lnurlSettled = fetchLnurl(p, amountSat, {
                signal,
                timeoutMs: opts?.timeoutMs,
            }).then(
                (invoice) => ({ ok: true as const, invoice }),
                (error: unknown) => ({ ok: false as const, error }),
            );

            try {
                const invoice = await bip353Promise;
                return { invoice, type: decodeInvoice(invoice).type };
            } catch (bip353Error) {
                const lnurl = await lnurlSettled;
                if (lnurl.ok) {
                    return {
                        invoice: lnurl.invoice,
                        type: decodeInvoice(lnurl.invoice).type,
                    };
                }
                // Neither channel resolved. Prefer surfacing an LNURL amount
                // error (actionable for the user) over the BIP-353 failure.
                throw isLnurlAmountError(lnurl.error)
                    ? lnurl.error
                    : (bip353Error ?? lnurl.error);
            }
        } finally {
            raceController.abort(new Error("resolution race settled"));
        }
    }

    if (isLnurl(p)) {
        const invoice = await fetchLnurl(p, amountSat, {
            signal: opts?.signal,
            timeoutMs: opts?.timeoutMs,
        });
        return { invoice, type: decodeInvoice(invoice).type };
    }

    // Network-aware gate: rejects e.g. BOLT11 invoices for another network,
    // which decodeInvoice alone would accept.
    if (!isInvoice(p)) {
        throw new Error("invalid invoice");
    }

    const { type } = decodeInvoice(p);
    return { invoice: p, type };
};
