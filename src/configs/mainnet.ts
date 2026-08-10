import { buildMainnetConfig } from "boltz-swaps/presets/mainnet";
import { type Config, baseConfig, chooseUrl } from "src/configs/base";
import { envRpcUrls } from "src/configs/rpcs";
import { usdt0CanSendOverrides } from "src/configs/usdt0";

const mainnetPreset = buildMainnetConfig({
    rpcUrls: envRpcUrls,
    canSend: usdt0CanSendOverrides,
    btcMempoolApiUrl: import.meta.env.VITE_MEMPOOL_API_URL || undefined,
    // Self-hosted: only BTC (on-chain + LN in UI) and L-BTC. Hide EVM/stablecoins
    // (RBTC, WBTC, USDT0, USDC, CCTP/OFT variants, ARK, …).
    filterAssets: (asset) => asset === "BTC" || asset === "L-BTC",
});

const config = {
    ...baseConfig,
    // Self-hosted: enable swaps in UI (upstream default is true for public site).
    swapsSuspended: false,
    // Onion di SATS Routing: sostituire con il nostro indirizzo .onion.
    // Finché è "" il link "Onion" nel footer resta nascosto (Footer usa <Show>).
    // Originale Boltz: "http://boltzzzbnus4m7mta3cxmflnps4fp7dueu2tgurstbvrbt6xswzcocyd.onion/"
    torUrl: "",
    network: "mainnet",
    loglevel: "debug",
    // Self-hosted same-origin API (nginx serves app + /v2 on LAN HTTPS and onion).
    // Empty string: fetch/WS use current origin. Both normal and tor must be ""
    // because isTor() switches to apiUrl.tor on *.onion hostnames.
    apiUrl: {
        normal: "",
        tor: "",
    },
    cctpApiUrl: mainnetPreset.cctpApiUrl,
    solburnUrl: mainnetPreset.solburnUrl,
    assets: mainnetPreset.assets,
} as Config;

export { config, chooseUrl };
