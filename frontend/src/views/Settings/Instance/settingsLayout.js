const is = (key, value) => (draft) => draft[key] === value;
const on = (key) => is(key, "true");
const provider = (name) => is("LLM_PROVIDER", name);

export const PROVIDER_LINKS = {
    openai: "https://platform.openai.com/api-keys",
    anthropic: "https://console.anthropic.com/settings/keys",
    deepseek: "https://platform.deepseek.com/api_keys",
    openai_compatible: "https://ollama.com/download",
};

/* A section names its fields in display order; `advanced` fields sit in a closed disclosure,
 * `paste` shows this instance's address for a provider's console, `when` hides the whole section. Fields no section names are
 * shown last, so a new catalog key is never lost. */
export const SECTIONS = {
    general: [
        { id: "basics", keys: ["APP_NAME", "CRON_TZ"] },
        { id: "addresses", keys: ["WEBURL", "APIURL"] },
    ],
    mail: [
        { id: "smtp", keys: ["NODEMAILER_HOST", "NODEMAILER_PORT", "NODEMAILER_EMAIL", "NODEMAILER_USER", "NODEMAILER_EMAIL_PASSWORD"] },
        { id: "resend", keys: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"], link: "https://resend.com/api-keys" },
    ],
    storage: [
        { id: "driver", keys: ["STORAGE_TYPE"] },
        { id: "s3", when: (draft) => draft.STORAGE_TYPE !== "server", keys: ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"], advanced: ["S3_PREFIX", "S3_FORCE_PATH_STYLE", "S3_PUBLIC_BASE_URL", "USERPROFILEBUCKET"] },
        { id: "legacy", keys: ["WASABI_ACCESS_KEY", "WASABI_SECRET_ACCESS_KEY", "WASABI_USERID", "WASABIENDPOINT", "WASABI_REGION", "IAM_ENDPOINT"] },
    ],
    ai: [
        { id: "basics", keys: ["AI_ENABLED", "WORKSPACE_GUIDE_AUTO_CREATE", "AI_FIELD_DAILY_LIMIT", "AI_REPLAY"] },
        {
            id: "provider",
            keys: ["LLM_PROVIDER", "AI_API_KEY", "AI_MODEL", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL",
                "OPENAI_COMPATIBLE_BASE_URL", "OPENAI_COMPATIBLE_API_KEY", "OPENAI_COMPATIBLE_MODEL", "OPENAI_COMPATIBLE_EMBEDDINGS_MODEL"],
            advanced: ["OPENAI_BASE_URL"],
            variant: (draft) => draft.LLM_PROVIDER,
            link: (draft) => PROVIDER_LINKS[draft.LLM_PROVIDER],
        },
        { id: "pricing", keys: ["LLM_PRICING"] },
        { id: "apps", keys: ["MCP_OAUTH", "MCP_TOOLS_DATA", "MCP_TOOLS_WORK", "MCP_TOOLS_MANAGE"] },
    ],
    auth: [
        { id: "email", keys: ["MAGIC_LINK_ENABLED", "TWO_FACTOR_ISSUER"] },
        { id: "sso", keys: ["SSO_LOGIN_ENABLED"] },
        { id: "google", keys: ["GOOGLE_LOGIN_ENABLED", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], link: "https://console.cloud.google.com/apis/credentials", paste: on("GOOGLE_LOGIN_ENABLED") },
        { id: "github", keys: ["GITHUB_LOGIN_ENABLED", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"], advanced: ["GITHUB_BASE_OAUTH_URL"], link: "https://github.com/settings/developers", paste: on("GITHUB_LOGIN_ENABLED") },
        { id: "gitlab", keys: ["GITLAB_LOGIN_ENABLED", "GITLAB_CLIENT_ID", "GITLAB_CLIENT_SECRET"], advanced: ["GITLAB_BASE_OAUTH_URL", "GITLAB_BASE_API_URL"], link: "https://gitlab.com/-/user_settings/applications", paste: on("GITLAB_LOGIN_ENABLED") },
    ],
    calling: [
        { id: "stun", keys: ["STUN_URLS"] },
        { id: "turn", keys: ["TURN_URLS", "TURN_STATIC_AUTH_SECRET", "TURN_USERNAME", "TURN_PASSWORD"], choice: "turnAuth", link: "https://github.com/coturn/coturn" },
    ],
    security: [
        { id: "access", keys: ["PERMISSION_ENFORCEMENT_MODE", "AGENT_TAINT_ROUTING"] },
        { id: "audit", keys: ["AUDIT_RETENTION_DAYS"] },
        { id: "network", keys: ["TRUST_PROXY", "GLOBAL_RATE_LIMIT_PER_MIN", "HELMET_ENABLED", "WEBHOOK_ALLOWED_PRIVATE_HOSTS"] },
    ],
};

export const CHOICES = {
    turnAuth: {
        options: ["secret", "password"],
        initial: (rows) => {
            const value = (key) => rows.find((r) => r.key === key)?.value;
            return !value("TURN_STATIC_AUTH_SECRET")?.set && (value("TURN_USERNAME") || value("TURN_PASSWORD")?.set) ? "password" : "secret";
        },
        keys: { secret: ["TURN_STATIC_AUTH_SECRET"], password: ["TURN_USERNAME", "TURN_PASSWORD"] },
    },
};

export const SHOW_WHEN = {
    AI_API_KEY: provider("openai"),
    AI_MODEL: provider("openai"),
    OPENAI_BASE_URL: provider("openai"),
    ANTHROPIC_API_KEY: provider("anthropic"),
    ANTHROPIC_MODEL: provider("anthropic"),
    DEEPSEEK_API_KEY: provider("deepseek"),
    DEEPSEEK_MODEL: provider("deepseek"),
    OPENAI_COMPATIBLE_BASE_URL: provider("openai_compatible"),
    OPENAI_COMPATIBLE_API_KEY: provider("openai_compatible"),
    OPENAI_COMPATIBLE_MODEL: provider("openai_compatible"),
    OPENAI_COMPATIBLE_EMBEDDINGS_MODEL: provider("openai_compatible"),
    GOOGLE_CLIENT_ID: on("GOOGLE_LOGIN_ENABLED"),
    GOOGLE_CLIENT_SECRET: on("GOOGLE_LOGIN_ENABLED"),
    GITHUB_CLIENT_ID: on("GITHUB_LOGIN_ENABLED"),
    GITHUB_CLIENT_SECRET: on("GITHUB_LOGIN_ENABLED"),
    GITHUB_BASE_OAUTH_URL: on("GITHUB_LOGIN_ENABLED"),
    GITLAB_CLIENT_ID: on("GITLAB_LOGIN_ENABLED"),
    GITLAB_CLIENT_SECRET: on("GITLAB_LOGIN_ENABLED"),
    GITLAB_BASE_OAUTH_URL: on("GITLAB_LOGIN_ENABLED"),
    GITLAB_BASE_API_URL: on("GITLAB_LOGIN_ENABLED"),
};

/* ICU still lists some zones by their old names; people look for the current ones. */
const RENAMED_ZONES = {
    "Asia/Calcutta": "Asia/Kolkata",
    "Asia/Katmandu": "Asia/Kathmandu",
    "Asia/Saigon": "Asia/Ho_Chi_Minh",
    "Asia/Rangoon": "Asia/Yangon",
    "Europe/Kiev": "Europe/Kyiv",
    "Atlantic/Faeroe": "Atlantic/Faroe",
    "America/Godthab": "America/Nuuk",
    "Pacific/Truk": "Pacific/Chuuk",
    "Pacific/Ponape": "Pacific/Pohnpei",
    "Pacific/Enderbury": "Pacific/Kanton",
};

export function timeZones() {
    const listed = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    const zones = [...new Set(listed.map((z) => RENAMED_ZONES[z] || z))].sort();
    const byRegion = new Map([["UTC", ["UTC"]]]);
    for (const zone of zones.filter((z) => z !== "UTC")) {
        const region = zone.includes("/") ? zone.split("/")[0] : zone;
        if (!byRegion.has(region)) byRegion.set(region, []);
        byRegion.get(region).push(zone);
    }
    return [...byRegion].map(([region, list]) => ({ region, zones: list }));
}

/* The sections a group shows, each holding the rows visible for the current draft. */
export function layout(group, rows, draft, ui) {
    const sections = SECTIONS[group] || [];
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const placed = new Set(sections.flatMap((s) => [...s.keys, ...(s.advanced || [])]));
    const chosenAway = (key) => Object.entries(CHOICES).some(([name, choice]) =>
        Object.entries(choice.keys).some(([option, keys]) => keys.includes(key) && ui[name] !== option));
    const pick = (keys = []) => keys
        .filter((key) => byKey.has(key) && !(SHOW_WHEN[key] && !SHOW_WHEN[key](draft)) && !chosenAway(key))
        .map((key) => byKey.get(key));
    const choiceKeys = (section) => (section.choice ? Object.values(CHOICES[section.choice].keys).flat() : []);
    const out = sections.filter((section) => !section.when || section.when(draft)).map((section) => ({
        id: section.id,
        choice: section.choice || "",
        rows: pick(section.keys.filter((key) => !choiceKeys(section).includes(key))),
        choiceRows: pick(section.keys.filter((key) => choiceKeys(section).includes(key))),
        advancedRows: pick(section.advanced),
        variant: section.variant ? section.variant(draft) : "",
        href: typeof section.link === "function" ? section.link(draft) : section.link || "",
        paste: section.paste ? section.paste(draft) : false,
    }));
    const rest = rows.filter((r) => !placed.has(r.key));
    if (rest.length) out.push({ id: "other", choice: "", rows: rest, choiceRows: [], advancedRows: [], variant: "", href: "", paste: false });
    return out.filter((s) => s.rows.length || s.choiceRows.length || s.advancedRows.length);
}
