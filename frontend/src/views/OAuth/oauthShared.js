import * as env from "@/config/env";

export const SCOPES = ["tasks:read", "tasks:write", "projects:read", "docs:read", "time:read", "time:write"];

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

/* The authorization server answers its metadata only while MCP_OAUTH is on, so its screens show only then. */
let availability = null;
export const oauthAvailable = () => {
    if (!availability) {
        availability = fetch(env.OAUTH_METADATA, { headers: { accept: "application/json" } })
            .then((res) => res.ok)
            .catch(() => false);
    }
    return availability;
};
