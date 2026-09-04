import { reactive } from "vue";
import * as env from "@/config/env";

const flag = (key) => process.env[key] === "true";

/* What the login page and the shell know before anyone is logged in. Starts from
 * the build-time VUE_APP_* values so a page painted before the fetch answers still
 * behaves, then takes whatever /api/v2/instance/public-config says. */
export const publicConfig = reactive({
    loaded: false,
    version: "",
    appName: "",
    webUrl: "",
    storageType: process.env.VUE_APP_STORAGE_TYPE || "",
    auth: {
        google: { enabled: flag("VUE_APP_IS_GOOGLE_LOGIN"), clientId: process.env.VUE_APP_GOOGLE_CLIENT_ID || "" },
        github: { enabled: flag("VUE_APP_IS_GITHUB_LOGIN"), clientId: process.env.VUE_APP_GITHUB_CLIENT_ID || "", baseUrl: process.env.VUE_APP_GITHUB_BASE_OAUTH_URL || "https://github.com/login/oauth" },
        gitlab: { enabled: flag("VUE_APP_IS_GITLAB_LOGIN"), clientId: process.env.VUE_APP_GITLAB_CLIENT_ID || "", baseUrl: process.env.VUE_APP_GITLAB_BASE_OAUTH_URL || "https://gitlab.com/oauth" },
        sso: process.env.VUE_APP_IS_SSO_LOGIN !== "false",
        magicLink: false,
    },
    firebase: {},
    demoMode: false,
});

export function applyPublicConfig(data = {}) {
    Object.assign(publicConfig, data, { auth: { ...publicConfig.auth, ...(data.auth || {}) }, loaded: true });
    env.setRuntimeConfig(publicConfig);
    return publicConfig;
}

export const enabledProviders = () => ["google", "github", "gitlab"].filter((p) => publicConfig.auth[p]?.enabled);
