import { BsEnvelopeFill, BsGithub, BsTwitter, BsYoutube } from "solid-icons/bs";
import { Show } from "solid-js";

import nostr from "../assets/nostr.svg";
import substack from "../assets/substack.svg";
import { config } from "../config";
import { useGlobalContext } from "../context/Global";
import "../style/footer.scss";
import ExternalLink from "./ExternalLink";

const Footer = () => {
    const { t } = useGlobalContext();

    return (
        <footer>
            <div class="socials">
                <Show when={config.githubUrl}>
                    <ExternalLink
                        title="Github"
                        class="github"
                        href={config.githubUrl}>
                        <BsGithub size={22} color="#22374F" />
                    </ExternalLink>
                </Show>
                <Show when={config.twitterUrl}>
                    <ExternalLink
                        title="Twitter"
                        class="twitter"
                        href={config.twitterUrl}>
                        <BsTwitter size={22} color="#22374F" />
                    </ExternalLink>
                </Show>
                <Show when={config.nostrUrl}>
                    <ExternalLink
                        title="Nostr"
                        class="nostr"
                        href={config.nostrUrl}>
                        <img src={nostr} alt="Nostr Logo" />
                    </ExternalLink>
                </Show>
                <Show when={config.blogUrl}>
                    <ExternalLink
                        title="Substack"
                        class="substack"
                        href={config.blogUrl}>
                        <img src={substack} alt="Substack Logo" />
                    </ExternalLink>
                </Show>
                <Show when={config.youtubeUrl}>
                    <ExternalLink
                        title="Youtube"
                        class="youtube"
                        href={config.youtubeUrl}>
                        <BsYoutube size={22} color="#22374F" />
                    </ExternalLink>
                </Show>
                <Show when={config.email}>
                    <ExternalLink
                        title={t("email")}
                        class="email"
                        href={"mailto:" + config.email}>
                        <BsEnvelopeFill size={22} color="#22374F" />
                    </ExternalLink>
                </Show>
            </div>
            <p class="footer-nav">
                {/* Partner/Branding/Status/Regtest nascosti per SATS Routing (codice conservato)
                <Show when={config.partnerUrl}>
                    <ExternalLink href={config.partnerUrl}>
                        {t("partner")}
                    </ExternalLink>{" "}
                </Show>
                <Show when={config.brandingUrl}>
                    |{" "}
                    <ExternalLink href={config.brandingUrl}>
                        {t("branding")}
                    </ExternalLink>{" "}
                </Show>
                <Show when={config.statusUrl}>
                    |{" "}
                    <ExternalLink href={config.statusUrl}>
                        {t("status")}
                    </ExternalLink>{" "}
                </Show>
                <Show when={config.regtestUrl}>
                    |{" "}
                    <ExternalLink href={config.regtestUrl}>
                        {t("regtest")}
                    </ExternalLink>
                </Show>
                */}
                {/* Onion (Tor): punteremo config.torUrl al nostro indirizzo .onion */}
                <Show when={config.torUrl}>
                    <ExternalLink href={config.torUrl!}>
                        {t("onion")}
                    </ExternalLink>
                </Show>
            </p>
            {/* Terms/Privacy nascosti per SATS Routing (codice conservato)
            <p class="legal-nav">
                <a href="/terms">{t("terms")}</a>
                <a href="/privacy">{t("privacy")}</a>
            </p>
            */}
            <p class="version">
                {t("version")}:{" "}
                <Show
                    when={config.repoUrl}
                    fallback={<span>{__APP_VERSION__}</span>}>
                    <ExternalLink
                        href={`${config.repoUrl}/releases/tag/v${__APP_VERSION__}`}>
                        {__APP_VERSION__}
                    </ExternalLink>
                </Show>
                , {t("commithash")}:{" "}
                <Show
                    when={config.repoUrl}
                    fallback={<span>{__GIT_COMMIT__}</span>}>
                    <ExternalLink
                        href={`${config.repoUrl}/commit/${__GIT_COMMIT__}`}>
                        {__GIT_COMMIT__}
                    </ExternalLink>
                </Show>
            </p>
            <p>{t("footer")}</p>
        </footer>
    );
};
export default Footer;
