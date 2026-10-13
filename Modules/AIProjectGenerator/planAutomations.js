'use strict';

const logger = require('../../Config/loggerConfig');
const projectSetup = require('../Agents/projectSetup');
const planWork = require('../Agents/planWork');
const rules = require('../Agents/automationRequests');
const { checkDraft } = require('../Automations/helpers/aiDraftCheck');
const { describeRule } = require('../Automations/helpers/sentenceRules');
const { whoOf } = require('../Agents/taskRequests');

const RULES_MAX = 3;
const STEPS_MAX = 3;
const RULES_READ = 20;
const NAME_MAX = 80;
const TEXT_MAX = 300;
const PLANNED = 'planned-project';
const OFF = 'is switched off on this server';

const listOf = (value) => (Array.isArray(value) ? value : []);
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const nameOf = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '');
const statusRows = (project) => listOf(objectOf(project).taskStatusData).map(objectOf).filter((row) => typeof row.name === 'string' && row.name.trim());

/* The project does not exist yet, so the plan's own statuses stand in, and no person can be named: only roles such as the task's creator. */
const plannedRefs = (project) => {
    const statuses = statusRows(project);
    return {
        projects: [{ id: PLANNED, name: PLANNED, statuses: statuses.map((row) => row.name), members: [] }],
        people: [],
        taskTypes: listOf(objectOf(project).taskTypeCounts).map((row) => objectOf(row).name).filter(Boolean),
        statusCatalogue: statuses.map((row, at) => ({ projectId: PLANNED, key: row.key === undefined ? `planned-${at}` : row.key, name: row.name, type: row.type || '' })),
    };
};

const draftCode = (message) => {
    if (message === rules.REFUSED.agentStep || message === rules.REFUSED.otherStep) return 'step';
    if (message === rules.REFUSED.notATask || /^there is no ".*" trigger/.test(message)) return 'trigger';
    return 'fit';
};

const checkedOf = (rule, project) => {
    if (!rule.actions.length || rule.actions.length > STEPS_MAX) return { problem: { code: 'steps', message: `a starter automation has 1 to ${STEPS_MAX} steps` } };
    const wrong = rules.draftProblem(rule);
    if (wrong) return { problem: { code: draftCode(wrong), message: wrong } };
    const checked = checkDraft({ trigger: rule.trigger, project: PLANNED, conditions: rule.conditions, actions: rule.actions }, plannedRefs(project));
    if (!checked.rule) return { problem: { code: 'fit', message: checked.rejected.join(' ') } };
    return { sentence: describeRule(checked.rule, { people: [] }).slice(0, TEXT_MAX) };
};

const note = (name, { code, message }, extra = {}) => ({ name, reason: String(message || '').slice(0, TEXT_MAX), code, ...extra });

/* Catalogue triggers and steps only, each a rule the plan's own statuses can hold; `sentence` is what will be made, for the person to read before approving. */
const trimRules = (given, project) => {
    const kept = [];
    const dropped = [];
    for (const entry of listOf(given).slice(0, RULES_READ)) {
        const name = nameOf(objectOf(entry).name);
        const rule = { name, ...planWork.ruleOf(entry) };
        if (!name) dropped.push(note(name, { code: 'name_missing', message: 'a rule needs a name' }));
        else if (kept.length >= RULES_MAX) dropped.push(note(name, { code: 'too_many', message: `a plan holds at most ${RULES_MAX} rules` }, { max: RULES_MAX }));
        else {
            const { problem, sentence } = checkedOf(rule, project);
            if (problem) dropped.push(note(name, problem));
            else kept.push({ ...rule, sentence });
        }
    }
    return { kept, dropped };
};

const refusalCode = (error) => {
    const message = String(error || '');
    if (message.includes(OFF)) return 'off';
    if (message === rules.REFUSED.filer || /only an owner or an admin/i.test(message)) return 'admin';
    if (/permission_denied|is not granted|may not make this part/.test(message)) return 'permission';
    return 'other';
};

const failed = (rule, reason) => ({ name: rule.name, reason: String(reason || '').slice(0, TEXT_MAX), code: refusalCode(reason) });

/* Made switched off, as the person who ran the generator, by the path an approved project.setup plan takes. Never throws, so a rule that fails cannot undo the project. */
const makeRules = async ({ companyId, uid, projectId, plan }) => {
    const person = { kind: 'human', userId: String(uid) };
    let kept = [];
    try {
        kept = trimRules(objectOf(plan).rules, objectOf(plan).project).kept;
        if (!kept.length) return { made: [], notMade: [] };
        const parts = await projectSetup.carryOut({
            companyId, who: whoOf(person), approvedBy: String(uid), projectId,
            plan: { rules: kept.map(planWork.ruleOf) }, asked: { actor: person, depth: 0, within: {} },
        });
        const part = parts.find((entry) => entry.part === 'rules') || { items: [] };
        if (part.error) return { made: [], notMade: kept.map((rule) => failed(rule, part.error)) };
        const items = kept.map((rule, at) => objectOf(listOf(part.items)[at]));
        return {
            made: kept.flatMap((rule, at) => (items[at].made ? [{ name: rule.name, sentence: rule.sentence, ruleId: String(items[at].ruleId || '') }] : [])),
            notMade: kept.flatMap((rule, at) => (items[at].made ? [] : [failed(rule, items[at].error)])),
        };
    } catch (error) {
        logger.warn(`[AIPG] rules not made in ${projectId}: ${error && error.message ? error.message : error}`);
        return { made: [], notMade: kept.map((rule) => failed(rule, error && error.message)) };
    }
};

module.exports = { RULES_MAX, STEPS_MAX, trimRules, makeRules, refusalCode };
