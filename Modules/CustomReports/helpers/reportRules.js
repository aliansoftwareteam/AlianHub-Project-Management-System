// REP-02 — pure custom-report config validation + Mongo pipeline builder.
// SAFETY: only allow-listed dimensions / metrics / filter-fields ever reach the
// database. The user's config supplies KEYS (validated against these maps) and
// filter VALUES (used only as equality match values) — never raw field names or
// operators — so a report config can't inject arbitrary Mongo. Unit-tested in
// tests/report-rules.test.js.

const SOURCES = ['tasks', 'timelogs'];

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

// Time logs store LogStartTime as unix SECONDS, so the month bucket has to go
// through $toDate rather than reading a BSON date.
const LOG_MONTH = {
    $dateToString: { format: '%Y-%m', date: { $toDate: { $multiply: ['$LogStartTime', 1000] } } },
};

const LOG_DIMENSIONS = {
    project: '$ProjectId',
    person: '$Loggeduser',
    month: LOG_MONTH,
};

// Minutes at the database; the caller converts. `revenue` sums minutes too —
// an hourly rate depends on the person and the project, so it is resolved
// per bucket by the controller against the billing_rates collection.
const LOG_METRICS = {
    hours: { $sum: '$LogTimeDuration' },
    entries: { $sum: 1 },
    revenue: { $sum: '$LogTimeDuration' },
};

const LOG_FILTERS = {
    project: 'ProjectId',
};

// Relative windows, in months. 'all' means no date bound.
const RANGES = { '1m': 1, '3m': 3, '6m': 6, '12m': 12, all: 0 };

const CHART_TYPES = ['bar', 'line', 'pie', 'table'];

const SOURCE_SPEC = {
    tasks: { dimensions: DIMENSIONS, metrics: METRICS, filters: FILTERS, defaultDimension: 'status', defaultMetric: 'count' },
    timelogs: { dimensions: LOG_DIMENSIONS, metrics: LOG_METRICS, filters: LOG_FILTERS, defaultDimension: 'project', defaultMetric: 'hours' },
};

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
const specOf = (source) => SOURCE_SPEC[source] || SOURCE_SPEC.tasks;

const validateConfig = (cfg = {}) => {
    const errors = [];
    const source = SOURCES.includes(cfg.source) ? cfg.source : 'tasks';
    const spec = specOf(source);
    const dimension = has(spec.dimensions, cfg.dimension) ? cfg.dimension : null;
    const metric = has(spec.metrics, cfg.metric) ? cfg.metric : spec.defaultMetric;
    const chartType = CHART_TYPES.includes(cfg.chartType) ? cfg.chartType : 'bar';
    if (!dimension) errors.push(`dimension must be one of: ${Object.keys(spec.dimensions).join(', ')}`);

    // Keep only allow-listed filter keys with a non-empty value.
    const filters = {};
    const raw = (cfg.filters && typeof cfg.filters === 'object' && !Array.isArray(cfg.filters)) ? cfg.filters : {};
    for (const k of Object.keys(raw)) {
        const v = raw[k];
        const usable = v !== undefined && v !== null && String(v).length;
        if (!usable) continue;
        if (has(spec.filters, k)) filters[k] = String(v);
        // Two filters are not plain field equality: a relative date window and
        // the billable flag (absent means billable, per the timesheet schema).
        else if (source === 'timelogs' && k === 'range' && has(RANGES, String(v))) filters.range = String(v);
        else if (source === 'timelogs' && k === 'billable' && ['yes', 'no'].includes(String(v))) filters.billable = String(v);
    }

    return {
        valid: errors.length === 0,
        errors,
        value: errors.length ? null : { source, dimension, metric, chartType, filters },
    };
};

const monthsAgoSeconds = (months, nowMs) => {
    const d = new Date(nowMs);
    d.setMonth(d.getMonth() - months);
    return Math.floor(d.getTime() / 1000);
};

const buildTaskPipeline = (cfg) => {
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

const buildLogPipeline = (cfg, nowMs) => {
    const match = {};
    const filters = (cfg && cfg.filters) || {};
    if (filters.project) match.ProjectId = filters.project;
    if (filters.billable === 'yes') match.billable = { $ne: false };
    if (filters.billable === 'no') match.billable = false;
    const months = RANGES[filters.range];
    if (months) match.LogStartTime = { $gte: monthsAgoSeconds(months, nowMs) };

    const dim = LOG_DIMENSIONS[cfg.dimension];
    // Revenue needs the person and the project of each bucket to resolve an
    // hourly rate, so it groups one level finer and is folded up afterwards.
    const groupId = cfg.metric === 'revenue'
        ? { dim, user: '$Loggeduser', project: '$ProjectId' }
        : dim;
    return [
        { $match: match },
        { $group: { _id: groupId, value: LOG_METRICS[cfg.metric] } },
        { $sort: { value: -1 } },
        { $limit: cfg.metric === 'revenue' ? 5000 : 100 },
    ];
};

// Build a safe aggregation pipeline for a VALIDATED config.
const buildPipeline = (cfg, { nowMs = Date.now() } = {}) => (
    (cfg && cfg.source === 'timelogs') ? buildLogPipeline(cfg, nowMs) : buildTaskPipeline(cfg)
);

module.exports = {
    SOURCES, DIMENSIONS, METRICS, FILTERS, CHART_TYPES,
    LOG_DIMENSIONS, LOG_METRICS, LOG_FILTERS, RANGES, SOURCE_SPEC,
    validateConfig, buildPipeline,
};
