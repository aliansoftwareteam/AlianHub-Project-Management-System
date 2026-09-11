const { ROLE_OWNER, ROLE_ADMIN } = require('../../Config/permissionGuard');

const TYPES = Object.freeze(['agent_error_rate', 'approval_rate_falling', 'cost_forecast', 'queue_age']);

const DEFAULTS = Object.freeze({
    enabled: false,
    errorRatePct: 20,
    errorMinRuns: 5,
    approvalFloorPct: 50,
    approvalDropPts: 20,
    costForecastPct: 110,
    queueAgeMinutes: 15,
});

const LIMITS = Object.freeze({
    errorRatePct: { min: 1, max: 100, integer: false },
    errorMinRuns: { min: 1, max: 1000, integer: true },
    approvalFloorPct: { min: 0, max: 100, integer: false },
    approvalDropPts: { min: 1, max: 100, integer: false },
    costForecastPct: { min: 1, max: 1000, integer: false },
    queueAgeMinutes: { min: 1, max: 1440, integer: true },
});

const ROLE_DEFAULTS = Object.freeze({
    [ROLE_OWNER]: Object.freeze({ agent_error_rate: true, approval_rate_falling: true, cost_forecast: true, queue_age: true }),
    [ROLE_ADMIN]: Object.freeze({ agent_error_rate: false, approval_rate_falling: false, cost_forecast: true, queue_age: true }),
});

const inRange = (key, n) => {
    const { min, max, integer } = LIMITS[key];
    return Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n));
};

const numberOf = (v) => (typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN));

const settingsOf = (stored) => {
    const s = stored && typeof stored === 'object' ? stored : {};
    const out = { enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULTS.enabled };
    Object.keys(LIMITS).forEach((key) => {
        const n = Number(s[key]);
        out[key] = s[key] !== undefined && s[key] !== null && inRange(key, n) ? n : DEFAULTS[key];
    });
    return out;
};

/* Merges a partial update over what is stored, so a PUT of one threshold keeps the rest. */
const validate = (patch, stored) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'alerts must be an object.' };
    const next = settingsOf(stored);
    const unknown = Object.keys(patch).filter((k) => k !== 'enabled' && !LIMITS[k]);
    if (unknown.length) return { error: `Unknown alert setting: ${unknown.join(', ')}.` };
    if (patch.enabled !== undefined) {
        if (typeof patch.enabled !== 'boolean') return { error: 'alerts.enabled must be true or false.' };
        next.enabled = patch.enabled;
    }
    for (const key of Object.keys(LIMITS)) {
        if (patch[key] !== undefined) {
            const n = numberOf(patch[key]);
            const { min, max, integer } = LIMITS[key];
            if (!inRange(key, n)) return { error: `alerts.${key} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.` };
            next[key] = n;
        }
    }
    return { value: next };
};

const isEligibleRole = (roleType) => Boolean(ROLE_DEFAULTS[Number(roleType)]);

const preferencesOf = (roleType, stored) => {
    const defaults = ROLE_DEFAULTS[Number(roleType)];
    if (!defaults) return null;
    const s = stored && typeof stored === 'object' ? stored : {};
    return Object.fromEntries(TYPES.map((type) => [type, typeof s[type] === 'boolean' ? s[type] : defaults[type]]));
};

const validatePreferences = (patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'aiAlerts must be an object.' };
    const entries = Object.entries(patch);
    if (!entries.length) return { error: 'aiAlerts is empty.' };
    const bad = entries.filter(([type, on]) => !TYPES.includes(type) || typeof on !== 'boolean').map(([type]) => type);
    if (bad.length) return { error: `aiAlerts takes true or false for ${TYPES.join(', ')}; not ${bad.join(', ')}.` };
    return { set: Object.fromEntries(entries.map(([type, on]) => [`aiAlerts.${type}`, on])) };
};

module.exports = { TYPES, DEFAULTS, LIMITS, ROLE_DEFAULTS, settingsOf, validate, isEligibleRole, preferencesOf, validatePreferences };
