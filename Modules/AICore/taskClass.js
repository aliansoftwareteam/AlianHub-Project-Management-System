/**
 * What the platform asks a model to do, in four shapes.
 *
 * Every feature in features.js falls into one of these. A class is the unit a
 * routing policy talks about, because a workspace does not want to choose a
 * model seventeen times — it wants "cheap for the small stuff, good for the
 * agent, roomy for the long reads".
 *
 * Each class declares what a model must clear to serve it:
 *   qualityFloor    — the lowest tier a candidate model may sit in
 *   latencyTargetMs — how long the caller is prepared to wait
 *   inputBudget     — how much prompt this class is allowed to send
 *
 * The quality floor and the latency target are what a workspace overrides; the
 * input budget is the platform's own and is not editable, because it is the
 * prompt these features build, not a preference.
 */
'use strict';

const { FEATURES } = require('./features');

/* Ordered worst to best: a floor passes when the candidate's tier index is at
 * least the floor's. */
const QUALITY = Object.freeze({ BASIC: 'basic', STANDARD: 'standard', HIGH: 'high', FRONTIER: 'frontier' });
const QUALITY_ORDER = Object.freeze([QUALITY.BASIC, QUALITY.STANDARD, QUALITY.HIGH, QUALITY.FRONTIER]);

const TASK_CLASS = Object.freeze({
    CLASSIFY: 'classify',
    ASSIST: 'assist',
    AGENT: 'agent',
    LONG_CONTEXT: 'long_context',
});

const DEFINITIONS = Object.freeze({
    [TASK_CLASS.CLASSIFY]: Object.freeze({
        key: TASK_CLASS.CLASSIFY,
        qualityFloor: QUALITY.BASIC,
        latencyTargetMs: 3000,
        inputBudgetTokens: 4000,
        features: Object.freeze([FEATURES.TASK_CATEGORY, FEATURES.TASK_ESTIMATE, FEATURES.CLARIFIER, FEATURES.DESCRIPTION]),
    }),
    [TASK_CLASS.ASSIST]: Object.freeze({
        key: TASK_CLASS.ASSIST,
        qualityFloor: QUALITY.STANDARD,
        latencyTargetMs: 8000,
        inputBudgetTokens: 16000,
        features: Object.freeze([FEATURES.ASK, FEATURES.ASSIST, FEATURES.TASK_SUMMARY, FEATURES.GUIDE, FEATURES.MCP_BRIEF]),
    }),
    [TASK_CLASS.AGENT]: Object.freeze({
        key: TASK_CLASS.AGENT,
        qualityFloor: QUALITY.HIGH,
        latencyTargetMs: 30000,
        inputBudgetTokens: 64000,
        features: Object.freeze([FEATURES.AGENT_RUN, FEATURES.PROJECT_PLAN, FEATURES.PROJECT_TASKS, FEATURES.PROJECT_TEMPLATE, FEATURES.PAGE_COMPOSE]),
    }),
    [TASK_CLASS.LONG_CONTEXT]: Object.freeze({
        key: TASK_CLASS.LONG_CONTEXT,
        qualityFloor: QUALITY.STANDARD,
        latencyTargetMs: 60000,
        inputBudgetTokens: 200000,
        features: Object.freeze([FEATURES.MEETING_NOTES, FEATURES.WORKLOAD_SUMMARY, FEATURES.PORTFOLIO_SUMMARY]),
    }),
});

const TASK_CLASS_LIST = Object.freeze(Object.keys(DEFINITIONS));

const DEFAULT_CLASS = TASK_CLASS.ASSIST;

const BY_FEATURE = Object.freeze(Object.fromEntries(
    TASK_CLASS_LIST.flatMap((key) => DEFINITIONS[key].features.map((feature) => [feature, key])),
));

const isTaskClass = (value) => TASK_CLASS_LIST.includes(value);

const isQuality = (value) => QUALITY_ORDER.includes(value);

const definitionOf = (key) => DEFINITIONS[key] || null;

/* An untagged or unknown feature lands on the interactive class rather than the
 * cheapest one: a wrong answer costs more than a few cents of tokens. */
const classOfFeature = (feature) => BY_FEATURE[feature] || DEFAULT_CLASS;

const meetsQuality = (tier, floor) => QUALITY_ORDER.indexOf(tier) >= QUALITY_ORDER.indexOf(floor);

const list = () => TASK_CLASS_LIST.map((key) => ({ ...DEFINITIONS[key], features: [...DEFINITIONS[key].features] }));

module.exports = {
    QUALITY, QUALITY_ORDER, TASK_CLASS, TASK_CLASS_LIST, DEFAULT_CLASS, DEFINITIONS,
    isTaskClass, isQuality, definitionOf, classOfFeature, meetsQuality, list,
};
