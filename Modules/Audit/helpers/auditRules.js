// SEC-04 audit rules. Pure — no I/O — shared by the recorder, controller, tests.

const RETENTION_DEFAULT_DAYS = 365;

const trim = (v, n = 300) => (v === undefined || v === null ? '' : String(v).slice(0, n));

/* Validate + shape an audit entry. `action` is required; everything else is
 * normalised/bounded. Returns { valid, reason, entry }. */
const normalizeAuditEntry = (e = {}) => {
    const action = trim(e.action, 120).trim();
    if (!action) return { valid: false, reason: 'action is required.', entry: null };
    return {
        valid: true,
        reason: '',
        entry: {
            actorId: trim(e.actorId),
            actorName: trim(e.actorName),
            action,
            entityType: trim(e.entityType, 60),
            entityId: trim(e.entityId),
            entityName: trim(e.entityName),
            meta: (e.meta && typeof e.meta === 'object' && !Array.isArray(e.meta)) ? e.meta : {},
            ip: trim(e.ip, 64),
        },
    };
};

/* Rows with createdAt < cutoff are pruned. */
const retentionCutoff = (now, retentionDays = RETENTION_DEFAULT_DAYS) => {
    const days = Number(retentionDays);
    const d = new Date(now);
    d.setDate(d.getDate() - (Number.isFinite(days) && days > 0 ? days : RETENTION_DEFAULT_DAYS));
    return d;
};

module.exports = { normalizeAuditEntry, retentionCutoff, RETENTION_DEFAULT_DAYS };
