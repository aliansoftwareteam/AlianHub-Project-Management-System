// Mirrors Modules/ApiTokens/helpers/apiTokenRules.js; the server refuses the same input, this only says so before sending.

export const TOKEN_SCOPES = ["read", "write"];
export const EXPIRY_CHOICES = [7, 30, 90, 180, 365];
export const DEFAULT_TOKEN_POLICY = { strict: false, scopes: TOKEN_SCOPES, minExpiryDays: 1, maxExpiryDays: 365, graceDays: 30, strictSince: null };
export const EXPIRY_OVER_MAX = "API_TOKEN_EXPIRY_OVER_MAX";

const maxDaysOf = (policy) => Number(policy?.maxExpiryDays) || DEFAULT_TOKEN_POLICY.maxExpiryDays;

/* The choices end at the maximum lifetime, which is itself offered when it is not a round choice. */
export const expiryChoicesFor = (policy) => {
    const max = maxDaysOf(policy);
    const within = EXPIRY_CHOICES.filter((days) => days <= max);
    return within.includes(max) ? within : [...within, max];
};

/* { field, key, params? } for the first thing that stops the form being sent, or null. */
export const tokenFormProblem = (form, policy) => {
    if (!String(form.name || "").trim()) return { field: "name", key: "Accounts.token_name_required" };
    if (!policy || !policy.strict) return null;
    if (!form.expiresInDays) return { field: "expiry", key: "Accounts.token_expiry_required" };
    if (Number(form.expiresInDays) > maxDaysOf(policy)) return { field: "expiry", key: "Accounts.token_expiry_over_max", params: { n: maxDaysOf(policy) } };
    if (!Array.isArray(form.scopes) || !form.scopes.length) return { field: "scopes", key: "Accounts.token_scope_required" };
    return null;
};
