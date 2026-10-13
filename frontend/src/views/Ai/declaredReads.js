import { parseEntry } from "@egressRules";

export const READ_KIND = "skill_read";
const HTTPS_PORT = 443;

export const HOST_STATES = Object.freeze(["allowed", "not_listed", "not_declarable"]);

export const HOST_REASONS = Object.freeze(["invalid", "address", "private", "scheme", "path", "wildcard", "port", "wildcard_dns"]);

export const CAPS = Object.freeze(["maxBytes", "timeoutMs", "maxRedirects"]);

/* The save errors S1 returns under a stable code; anything else keeps the server's own words. */
export const READ_ERROR_CODES = Object.freeze([
    "host_not_allowed", "invalid_path", "credential_invalid", "credential_not_found", "credential_wrong_kind",
    "credential_revoked", "credential_store_off", "credential_store_unavailable", "credential_host_not_bound",
    "allowlist_unreadable", "secret_in_body"
]);

export const readerOf = (catalogues, key) => (catalogues?.readers || []).find((r) => r.key === key) || null;

export const isExternalReader = (catalogues, key) => Boolean(readerOf(catalogues, key)?.external);

export const offersExternalReads = (catalogues) => (catalogues?.readers || []).some((r) => r.external);

const hostPort = (text) => {
    const { entry } = parseEntry(String(text || ""));
    return entry && !entry.suffix ? { host: entry.host, port: entry.port || HTTPS_PORT } : null;
};

/* The same exact host-and-port match the server makes before it sends a credential. */
export const credentialsForHost = (secrets, host) => {
    const wanted = hostPort(host);
    if (!wanted) return [];
    return (secrets || []).filter((s) => s && s.kind === READ_KIND && !s.revokedAt
        && (s.hosts || []).some((h) => {
            const named = hostPort(h);
            return Boolean(named) && named.host === wanted.host && named.port === wanted.port;
        }));
};

const readParamOf = (field) => {
    const match = /^gather\[(\d+)\]\.params\.(\w+)$/.exec(field || "");
    return match ? { at: Number(match[1]), name: match[2] } : null;
};

/* One error as the editor shows it: a known code in the reader's language, the rest as the server wrote it. */
export const readErrorText = (error, t, { catalogues, gather } = {}) => {
    if (!error) return "";
    const { code, reason, host } = error;
    if (code === "host_not_allowed") {
        return reason && HOST_REASONS.includes(reason)
            ? t(`Ai.skill_read_host_${reason}`, { host: host || "" })
            : t("Ai.skill_read_err_host_not_allowed", { host: host || "" });
    }
    if (READ_ERROR_CODES.includes(code)) return t(`Ai.skill_read_err_${code}`);
    const slot = readParamOf(error.field);
    const step = slot && gather ? gather[slot.at] : null;
    if (step && isExternalReader(catalogues, step.reader)) {
        const rule = readerOf(catalogues, step.reader).params?.[slot.name];
        if (code === "required") return rule?.unless ? t(`Ai.skill_read_err_${slot.name}_or_${rule.unless}`) : t("Ai.skill_read_err_required");
        if (code === "undeclared_input" && rule?.type === "input") return t("Ai.skill_read_err_link_undeclared", { input: step.params?.[slot.name] || "" });
        if (code === "invalid_params" && rule?.type === "input") return t("Ai.skill_read_err_link_invalid");
        if (code === "invalid_params" && rule?.type === "hosts") return t("Ai.skill_read_err_hosts_max", { max: rule.max });
        if (code === "invalid_params" && rule?.type === "number") return t("Ai.skill_read_err_range", { min: rule.min, max: rule.max });
    }
    return error.message || "";
};

export const withoutBlanks = (params) => Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== "" && v !== null && v !== undefined));

/* The link inputs the skill declares, plus a saved one it no longer does, so the save still names it and the server says why. */
export const linkChoices = (rule, declared, current) => {
    const offered = (rule?.values || []).filter((key) => (declared || []).includes(key));
    return current && !offered.includes(current) ? [...offered, current] : offered;
};

/* A param the catalogue takes only without another ("path" unless "link") stays in the form but is not sent,
 * since the server refuses both at once. */
export const paramsToSave = (catalogues, reader, params) => {
    const spec = readerOf(catalogues, reader)?.params || {};
    const given = withoutBlanks(params);
    const out = {};
    Object.entries(given).forEach(([name, value]) => {
        const rule = spec[name];
        if (rule?.unless && given[rule.unless] !== undefined) return;
        if (rule?.type === "hosts" && Array.isArray(value)) {
            const hosts = value.map((h) => String(h).trim()).filter(Boolean);
            if (hosts.length) out[name] = hosts;
            return;
        }
        out[name] = value;
    });
    return out;
};

/* A reader change keeps only what the new reader takes; the server refuses the rest by name. */
export const paramsKeptFor = (catalogues, reader, params) => {
    const spec = readerOf(catalogues, reader)?.params || {};
    return Object.fromEntries(Object.entries(params || {}).filter(([name]) => name in spec));
};
