import * as env from "@/config/env";

// Wider than read and write, so never ticked for anyone: a person or an admin gives one by ticking it.
export const MANAGE_SCOPES = ["tasks:manage", "docs:manage"];
export const PLAIN_SCOPES = ["tasks:read", "tasks:write", "projects:read", "docs:read", "time:read", "time:write"];
export const SCOPES = [...PLAIN_SCOPES, ...MANAGE_SCOPES];
export const isManageScope = (scope) => MANAGE_SCOPES.includes(scope);

const keyOf = (scope) => String(scope).replace(/[^a-z]/g, "_");

// A sentence for the consent screen, and a short name for lists.
export const scopeSentenceKey = (scope) => `OAuthConsent.scope_${keyOf(scope)}`;
export const scopeNameKey = (scope) => `OAuthConsent.scope_name_${keyOf(scope)}`;

export const refusalOf = (error, fallback) => {
    const data = error?.response?.data;
    return (data && typeof data === "object" && (data.statusText || data.error_description || data.message)) || fallback;
};

export const formatWhen = (value) => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
};

/* Asked of the public config rather than of the authorization server, whose routes do not exist with MCP_OAUTH
 * off: a 404 there would land in every settings page's console. */
let availability = null;
export const oauthAvailable = () => {
    if (!availability) {
        availability = fetch(env.INSTANCE_PUBLIC_CONFIG, { headers: { accept: "application/json" } })
            .then((res) => (res.ok ? res.json() : null))
            .then((body) => body?.data?.mcpOAuth === true)
            .catch(() => false);
    }
    return availability;
};
