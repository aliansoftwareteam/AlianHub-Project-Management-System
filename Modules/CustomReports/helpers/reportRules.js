// REP-02 — pure custom-report config validation + Mongo pipeline builder.
// SAFETY: only allow-listed dimensions / metrics / filter-fields ever reach the
// database. The user's config supplies KEYS (validated against these maps) and
// filter VALUES (used only as equality match values) — never raw field names or
// operators — so a report config can't inject arbitrary Mongo. Unit-tested in
// tests/report-rules.test.js.

const SOURCES = ['tasks'];

// dimension key → the task field expression to $group on.
const DIMENSIONS = {
    status: '$statusType',
    project: '$ProjectID',
    sprint: '$sprintId',
};

// metric key → the $group accumulator.
const METRICS = {
    count: { $sum: 1 },
    points: { $sum: '$points' },
};

// filter key → the task field it constrains (equality match).
const FILTERS = {
    project: 'ProjectID',
    status: 'statusType',
    sprint: 'sprintId',
};

const CHART_TYPES = ['bar', 'pie', 'table'];

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

const validateConfig = (cfg = {}) => {
    const errors = [];
    const source = SOURCES.includes(cfg.source) ? cfg.source : 'tasks';
    const dimension = has(DIMENSIONS, cfg.dimension) ? cfg.dimension : null;
    const metric = has(METRICS, cfg.metric) ? cfg.metric : 'count';
    const chartType = CHART_TYPES.includes(cfg.chartType) ? cfg.chartType : 'bar';
    if (!dimension) errors.push(`dimension must be one of: ${Object.keys(DIMENSIONS).join(', ')}`);

    // Keep only allow-listed filter keys with a non-empty value.
    const filters = {};
    const raw = (cfg.filters && typeof cfg.filters === 'object' && !Array.isArray(cfg.filters)) ? cfg.filters : {};
    for (const k of Object.keys(raw)) {
        if (has(FILTERS, k)) {
            const v = raw[k];
            if (v !== undefined && v !== null && String(v).length) filters[k] = String(v);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        value: errors.length ? null : { source, dimension, metric, chartType, filters },
    };
};

// Build a safe aggregation pipeline for a VALIDATED config.
const buildPipeline = (cfg) => {
    const match = { deletedStatusKey: { $in: [0, 2, undefined] }, isParentTask: true };
    const filters = (cfg && cfg.filters) || {};
    for (const k of Object.keys(filters)) {
        const field = FILTERS[k];
        if (field) match[field] = filters[k];
    }
    return [
        { $match: match },
        { $group: { _id: DIMENSIONS[cfg.dimension], value: METRICS[cfg.metric] } },
        { $sort: { value: -1 } },
        { $limit: 100 },
    ];
};

module.exports = { SOURCES, DIMENSIONS, METRICS, FILTERS, CHART_TYPES, validateConfig, buildPipeline };
