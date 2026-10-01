const BUDGET_TASKS = 10000;

/* The finish line in docs/PERFORMANCE.md. `atLeast` budgets are floors (frames per second); the rest are ceilings. */
const BUDGETS = {
    'list.firstRows': { limit: 1500, unit: 'ms' },
    'board.firstCards': { limit: 1500, unit: 'ms' },
    'list.statusChange': { limit: 150, unit: 'ms' },
    'list.openTaskPanel': { limit: 150, unit: 'ms' },
    'list.scrollFps': { limit: 50, unit: 'fps', atLeast: true },
    'api.listFirstPage': { limit: 300, unit: 'ms' },
    'api.listOpen': { limit: 300, unit: 'ms' },
    'everything.firstRows': { limit: 1500, unit: 'ms' },
};

/* Every request the Everything page makes is a task query's first page, so each has that budget. */
const EVERYTHING_API = { prefix: 'api.everything', budget: { limit: 300, unit: 'ms' } };

const budgetOf = (key) => BUDGETS[key] || (String(key).startsWith(EVERYTHING_API.prefix) ? EVERYTHING_API.budget : null);
const budgetFor = (metric, tasks) => (tasks === BUDGET_TASKS ? budgetOf(metric.key) : null);

/* A budget is judged on the median of the runs; p95 is reported beside it. */
const verdict = (metric, tasks) => {
    const budget = budgetFor(metric, tasks);
    if (metric.median === null || metric.median === undefined) return 'not measured';
    if (!budget) return tasks === BUDGET_TASKS ? 'no budget' : 'measured, no budget yet';
    const met = budget.atLeast ? metric.median >= budget.limit : metric.median < budget.limit;
    if (met) return 'met';
    const gap = Math.round(Math.abs(metric.median - budget.limit) * 10) / 10;
    return `missed by ${gap} ${budget.unit}`;
};

const budgetText = (metric, tasks) => {
    const budget = budgetFor(metric, tasks);
    if (!budget) return '';
    return `${budget.atLeast ? '≥' : '<'} ${budget.limit} ${budget.unit}`;
};

const value = (number, unit) => (number === null || number === undefined ? '' : `${number} ${unit}`);
const cell = (text) => String(text).replace(/\|/g, '\\|');

const COLUMNS = ['Date', 'Build', 'Machine', 'Tasks', 'Metric', 'Median', 'p95', 'Runs', 'Budget', 'Result', 'Detail'];

const markdownTable = ({ date, build, machine, tasks, metrics }) => {
    const rows = metrics.map((metric) => [
        date, build, machine, tasks, metric.label,
        value(metric.median, metric.unit), value(metric.p95, metric.unit), metric.runs,
        budgetText(metric, tasks), verdict(metric, tasks), metric.detail || '',
    ]);
    return [
        `| ${COLUMNS.join(' | ')} |`,
        `| ${COLUMNS.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
    ].join('\n');
};

module.exports = { BUDGETS, BUDGET_TASKS, budgetOf, verdict, budgetText, markdownTable };
