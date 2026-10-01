/* Reads what an aggregate's `explain('executionStats')` says about a query in the few terms a speed budget cares
 * about: which index was walked, whether the sort came from it or was done in memory, and how many index keys and
 * documents were read for the rows returned. MongoDB reports the plan in two shapes (a `$cursor` stage followed by
 * the pipeline stages it could not push down, or one plan for the whole pipeline) and nests the plan under
 * `queryPlan` when the slot-based engine ran it; all of them are read here. */

const cursorOf = (explain) => {
    if (!explain || typeof explain !== 'object') return {};
    if (!Array.isArray(explain.stages)) return explain;
    const first = explain.stages.find((stage) => stage && stage.$cursor);
    return first ? first.$cursor : {};
};

const winningPlanOf = (cursor) => {
    const winning = cursor.queryPlanner && cursor.queryPlanner.winningPlan;
    return winning && winning.queryPlan ? winning.queryPlan : winning || null;
};

const walk = (plan, visit) => {
    if (!plan || typeof plan !== 'object') return;
    visit(plan);
    [plan.inputStage, ...(Array.isArray(plan.inputStages) ? plan.inputStages : [])].forEach((child) => walk(child, visit));
};

const unique = (list) => [...new Set(list)];

function summarisePlan(explain) {
    const cursor = cursorOf(explain);
    const stages = [];
    const indexes = [];
    walk(winningPlanOf(cursor), (stage) => {
        if (stage.stage) stages.push(stage.stage);
        if (stage.stage === 'IXSCAN' && stage.indexName) indexes.push(stage.indexName);
    });
    const stats = cursor.executionStats || (explain && explain.executionStats) || {};
    const number = (value) => (Number.isFinite(value) ? value : null);
    return {
        stages: unique(stages),
        indexes: unique(indexes),
        sortInMemory: stages.includes('SORT'),
        collectionScan: stages.includes('COLLSCAN'),
        // What the server still does after the cursor, in pipeline order: a $group, a $sort of the groups.
        pipelineStages: Array.isArray(explain && explain.stages) ? explain.stages.filter((stage) => stage && !stage.$cursor).map((stage) => Object.keys(stage)[0]) : [],
        keysExamined: number(stats.totalKeysExamined),
        docsExamined: number(stats.totalDocsExamined),
        returned: number(stats.nReturned),
        millis: number(stats.executionTimeMillis),
    };
}

const count = (value) => (value === null ? '?' : String(value));

/* One line for the results table. `sorted` is false for a query that asks for no order (a count). */
function planText(summary, { sorted = true } = {}) {
    const source = summary.collectionScan ? 'collection scan' : summary.indexes.length ? `index ${summary.indexes.join(' + ')}` : 'no index named';
    const order = sorted ? (summary.sortInMemory ? ', sorted in memory' : ', order from the index') : '';
    return `${source}${order}; ${count(summary.keysExamined)} keys and ${count(summary.docsExamined)} docs read for ${count(summary.returned)} returned`;
}

module.exports = { summarisePlan, planText };
