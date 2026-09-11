// Field-level diff between two revision snapshots, computed on the client so
// the history panel can compare any pair without a server round trip.

const SKILL_KEY = (s) => (s && typeof s === "object" ? s.key || s.slug || s.name : String(s));

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const canonical = (v) => {
    if (Array.isArray(v)) return v.map(canonical);
    if (isObject(v)) return Object.keys(v).sort().reduce((out, k) => { out[k] = canonical(v[k]); return out; }, {});
    return v === undefined ? null : v;
};

export const sameValue = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const identity = (key) => key;

/* Skills are compared by key and enabled flag: the name is display only. */
const skillsSummary = (list, t) => (Array.isArray(list)
    ? list.map((s) => (s && typeof s === "object" && s.enabled === false ? t("Ai.revision_skill_off", { key: SKILL_KEY(s) }) : SKILL_KEY(s)))
    : []);

export const formatValue = (field, value, t = identity) => {
    if (value === undefined || value === null || value === "") return t("Ai.revision_value_empty");
    if (field === "skills") return skillsSummary(value, t).join(", ") || t("Ai.revision_value_empty");
    if (Array.isArray(value)) return value.length ? value.map(String).join(", ") : t("Ai.revision_value_empty");
    if (isObject(value)) return JSON.stringify(value);
    if (typeof value === "boolean") return t(value ? "Ai.revision_value_true" : "Ai.revision_value_false");
    return String(value);
};

const FIELD_ORDER = ["name", "description", "skills", "allowedActions", "projectIds", "autonomy", "spendCapUsd", "rateLimitPerDay", "account", "model", "schedule", "trigger"];

export const diffSnapshots = (from, to, t = identity) => {
    const a = from || {};
    const b = to || {};
    const fields = [...new Set([...FIELD_ORDER, ...Object.keys(a), ...Object.keys(b)])].filter((f) => f in a || f in b);
    return fields
        .filter((field) => !sameValue(a[field], b[field]))
        .map((field) => ({ field, from: a[field], to: b[field], fromText: formatValue(field, a[field], t), toText: formatValue(field, b[field], t) }));
};

/* The pair the panel opens on: the live revision against the one before it. */
export const defaultPair = (revisions) => {
    const list = Array.isArray(revisions) ? [...revisions].sort((x, y) => x.n - y.n) : [];
    if (!list.length) return { from: null, to: null };
    const live = list.find((r) => r.state === "live") || list[list.length - 1];
    const before = [...list].reverse().find((r) => r.n < live.n) || null;
    return { from: before ? before.n : null, to: live.n };
};
