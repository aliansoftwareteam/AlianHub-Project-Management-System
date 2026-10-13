'use strict';

const logger = require('../../Config/loggerConfig');
const projectSetup = require('../Agents/projectSetup');
const planWork = require('../Agents/planWork');
const rules = require('../Agents/automationRequests');
const { checkDraft } = require('../Automations/helpers/aiDraftCheck');
const { whoOf } = require('../Agents/taskRequests');

const RULES_MAX = 3;
const RULES_READ = 20;
const NAME_MAX = 80;
const PLANNED = 'planned-project';
const OFF = 'is switched off on this server';

const listOf = (value) => (Array.isArray(value) ? value : []);
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const nameOf = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '');
const statusRows = (project) => listOf(objectOf(project).taskStatusData).map(objectOf).filter((row) => typeof row.name === 'string' && row.name.trim());

/* Statuses here are the plan's own, since the project does not exist yet; no person is named, so a rule may only point at roles such as the task's creator. */
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

const problemOf = (rule, project) => {
    const wrong = rules.draftProblem(rule);
    if (wrong) return { code: draftCode(wrong), message: wrong };
    const checked = checkDraft({ trigger: rule.trigger, project: PLANNED, conditions: rule.conditions, actions: rule.actions }, plannedRefs(project));
    return checked.rule ? null : { code: 'fit', message: checked.rejected.join(' ') };
};

/* The rules a plan may ask for: catalogue triggers and steps only, each one a rule the plan's own statuses can hold, at most three; one that fails is dropped with the reason. */
const trimRules = (given, project) => {
    const kept = [];
    const dropped = [];
    for (const entry of listOf(given).slice(0, RULES_READ)) {
        const name = nameOf(objectOf(entry).name);
        const rule = { name, ...planWork.ruleOf(entry) };
        const problem = !name ? { code: 'name_missing', message: 'a rule needs a name' }
            : kept.length >= RULES_MAX ? { code: 'too_many', message: `a plan holds at most ${RULES_MAX} rules` }
                : problemOf(rule, project);
        if (problem) dropped.push({ name, reason: problem.message, code: problem.code });
        else kept.push(rule);
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

const failed = (rule, reason) => ({ name: rule.name, reason, code: refusalCode(reason) });

/* The rules made, switched off, in a project that exists, as the person who ran the generator and through the same
 * path an approved project.setup plan takes; nothing here throws, so a rule that fails never undoes the project. */
const makeRules = async ({ companyId, uid, projectId, plan }) => {
    const { kept } = trimRules(objectOf(plan).rules, objectOf(plan).project);
    if (!kept.length) return { made: [], notMade: [] };
    const person = { kind: 'human', userId: String(uid) };
    try {
        const parts = await projectSetup.carryOut({
            companyId, who: whoOf(person), approvedBy: String(uid), projectId,
            plan: { rules: kept.map(planWork.ruleOf) }, asked: { actor: person, depth: 0, within: {} },
        });
        const part = parts.find((entry) => entry.part === 'rules') || { items: [] };
        if (part.error) return { made: [], notMade: kept.map((rule) => failed(rule, part.error)) };
        const items = kept.map((rule, at) => objectOf(listOf(part.items)[at]));
        return {
            made: kept.flatMap((rule, at) => (items[at].made ? [{ name: rule.name, ruleId: String(items[at].ruleId || '') }] : [])),
            notMade: kept.flatMap((rule, at) => (items[at].made ? [] : [failed(rule, items[at].error)])),
        };
    } catch (error) {
        logger.warn(`[AIPG] rules not made in ${projectId}: ${error && error.message ? error.message : error}`);
        return { made: [], notMade: kept.map((rule) => failed(rule, error && error.message)) };
    }
};

module.exports = { RULES_MAX, trimRules, makeRules, refusalCode };
