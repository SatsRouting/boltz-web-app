import { Show, createSignal } from "solid-js";

import { useGlobalContext } from "../context/Global";
import { InvalidPassphraseError } from "../utils/rescueEncryption";

// Blocking overlay shown when the Rescue Key is encrypted and has not been
// unlocked yet in this session. Until it is unlocked the app has no mnemonic to
// derive keys from, so the user must enter the passphrase before continuing.
const RescueFileUnlock = () => {
    const { t, rescueFileLocked, unlockRescueFile } = useGlobalContext();

    const [passphrase, setPassphrase] = createSignal("");
    const [error, setError] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal(false);

    const submit = async (event: Event) => {
        event.preventDefault();
        if (busy() || passphrase().length === 0) {
            return;
        }

        setBusy(true);
        setError(null);
        try {
            await unlockRescueFile(passphrase());
            setPassphrase("");
        } catch (err) {
            setError(
                err instanceof InvalidPassphraseError
                    ? t("unlock_rescue_key_invalid")
                    : String(err),
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <Show when={rescueFileLocked()}>
            <div
                style={{
                    position: "fixed",
                    inset: "0",
                    "z-index": "10000",
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "center",
                    padding: "20px",
                    background: "rgba(0, 0, 0, 0.85)",
                }}>
                <div
                    class="frame"
                    role="dialog"
                    aria-modal="true"
                    style={{ "max-width": "420px", width: "100%" }}>
                    <h2>{t("unlock_rescue_key_title")}</h2>
                    <p>{t("unlock_rescue_key_description")}</p>
                    <form onSubmit={submit}>
                        <input
                            type="password"
                            autocomplete="current-password"
                            placeholder={t("unlock_rescue_key_placeholder")}
                            value={passphrase()}
                            onInput={(e) =>
                                setPassphrase(e.currentTarget.value)
                            }
                            data-testid="rescue-unlock-input"
                            style={{ width: "100%", "margin-bottom": "12px" }}
                        />
                        <Show when={error() !== null}>
                            <p style={{ color: "var(--color-error, #f66)" }}>
                                {error()}
                            </p>
                        </Show>
                        <button
                            class="btn"
                            type="submit"
                            disabled={busy() || passphrase().length === 0}
                            data-testid="rescue-unlock-submit">
                            {t("unlock_rescue_key_button")}
                        </button>
                    </form>
                </div>
            </div>
        </Show>
    );
};

export default RescueFileUnlock;
