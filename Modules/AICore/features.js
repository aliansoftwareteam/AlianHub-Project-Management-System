/* Closed list of the product features that spend tokens. Every model call
 * carries one so the budget can be read per feature; a call with none is a
 * test failure and a runtime warning booked as `unknown`. */
const FEATURES = Object.freeze({
    AGENT_RUN: 'agent_run',
    PROJECT_PLAN: 'project_plan',
    PROJECT_TASKS: 'project_tasks',
    CLARIFIER: 'clarifier',
    MEETING_NOTES: 'meeting_notes',
    TASK_SUMMARY: 'task_summary',
    DESCRIPTION: 'description',
    TASK_CATEGORY: 'task_category',
    TASK_ESTIMATE: 'task_estimate',
    WORKLOAD_SUMMARY: 'workload_summary',
    ASK: 'ask',
    ASSIST: 'assist',
    PROJECT_TEMPLATE: 'project_template',
    PORTFOLIO_SUMMARY: 'portfolio_summary',
    PAGE_COMPOSE: 'page_compose',
    GUIDE: 'guide',
    MCP_BRIEF: 'mcp_brief',
});

const UNKNOWN_FEATURE = 'unknown';

const FEATURE_LIST = Object.freeze(Object.values(FEATURES));

const isFeature = (value) => FEATURE_LIST.includes(value);

module.exports = { FEATURES, FEATURE_LIST, UNKNOWN_FEATURE, isFeature };
