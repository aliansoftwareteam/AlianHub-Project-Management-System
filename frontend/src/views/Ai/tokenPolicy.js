// Mirrors Modules/ApiTokens/helpers/apiTokenRules.js; the server refuses the same input, this only says so before sending.

export const TOKEN_SCOPES = ["read", "write"];
export const EXPIRY_CHOICES = [7, 30, 90, 180, 365];
export const DEFAULT_TOKEN_POLICY = { strict: false, scopes: TOKEN_SCOPES, minExpiryDays: 1, maxExpiryDays: 365, graceDays: 30, strictSince: null, graceEndsAt: null };

/* { field, key } for the first thing that stops the form being sent, or null. */
export const tokenFormProblem = (form, policy) => {
    if (!String(form.name || "").trim()) return { field: "name", key: "Accounts.token_name_required" };
    if (!policy || !policy.strict) return null;
    if (!form.expiresInDays) return { field: "expiry", key: "Accounts.token_expiry_required" };
    if (!Array.isArray(form.scopes) || !form.scopes.length) return { field: "scopes", key: "Accounts.token_scope_required" };
    return null;
};
