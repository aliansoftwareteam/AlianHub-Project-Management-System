const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const logger = require('../../Config/loggerConfig');
const { workingDaysOf } = require('../Company/helpers/companyWeek');
const { DAY_MS } = require('../../utils/localDay');
const { FEATURES } = require('../AICore/features');
const aiSwitch = require('../AICore/aiSwitch');
const { isAnyProviderConfigured } = require('../AICore/llmProvider');
const { checkConfiguredModelPriced } = require('../AICore/usage');
const { askModel } = require('../AICore/modelCall');
const { CLOSED_STATUS_TYPES } = require('../Tasks/helpers/taskSignals');
const { PRIORITIES, ESTIMATE_MAX_MINUTES } = require('./taskRequests');
const budget = require('./budget');
const proposals = require('./proposals');
const findings = require('./manager/findings');
const filing = require('./manager/filing');
const { RULE, isWorkingDay } = require('./manager/rules');

// Kept apart from the daily look (./manager), which asks no model. New tasks of a switched-on project, sorted by the server's configured model: a suggested priority, estimate and likely
// duplicate. One call covers a batch. Each suggestion waits as a proposal; nothing here changes a task.

const KIND = Object.freeze({ PRIORITY: 'priority', ESTIMATE: 'estimate', DUPLICATE: 'duplicate' });
const SKIPPED = Object.freeze({ NOT_DUE: 'not_due', AI_OFF: 'ai_off', NO_PROVIDER: 'no_provider', UNPRICED: 'unpriced', BUDGET: 'budget', DAILY_CAP: 'daily_cap', NO_NEW_TASKS: 'no_new_tasks', NO_ANSWER: 'no_answer' });
/* DAILY_USD bounds a workspace that set no monthly budget; a workspace with a budget is bounded by it instead. */
const CAPS = Object.freeze({ BATCH: 10, NEIGHBOURS: 40, TEXT: 400, NAME: 160, REASON: 160, MAX_TOKENS: 2500, LOOKBACK_DAYS: 7, DAILY_USD: 0.5 });
const TASK_FIELDS = { TaskName: 1, TaskKey: 1, description: 1, rawDescription: 1, Task_Priority: 1, totalEstimatedTime: 1, points: 1, createdAt: 1 };
const LOG_PREFIX = '[project-triage]';
const MARKUP = /<[^>]*>/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

const SKILL = Object.freeze({
    maxTokens: CAPS.MAX_TOKENS,
    systemPrompt: [
        'You triage new tasks for a project manager. You get new tasks (ids n1, n2, …) and other open tasks of the same project (ids o1, o2, …).',
        'For each new task you may suggest a priority (URGENT, HIGH, MEDIUM or LOW), an estimate in whole minutes, and the id of one task it likely duplicates.',
        'Suggest only what the task text supports; leave a field out when you are unsure. A duplicate is another task asking for the same work, never the task itself.',
        'Return exactly one JSON object: {"suggestions": [{"id": "n1", "priority": "HIGH", "estimateMinutes": 120, "duplicateOf": "o3", "reason": "one short sentence"}]}.',
    ].join(' '),
});

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const find = async (companyId, data) => (await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data }, 'find')) || [];
const find2 = async (companyId, data) => (await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data }, 'find')) || [];
const clean = (value, cap) => {
    const text = String(value === undefined || value === null ? '' : value).replace(MARKUP, ' ').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
    return text.length > cap ? `${text.slice(0, cap - 1)}…` : text;
};
const hasEstimate = (task) => Number(task.totalEstimatedTime) > 0 || Number(task.points) > 0;
const keyOf = (task) => task.TaskKey || '';
const dayOf = (now) => new Date(now).toISOString().slice(0, 10);
const tokensSpent = (usage) => Boolean(usage) && [usage.totalTokens, usage.inputTokens, usage.outputTokens].some((n) => Number(n) > 0);

const spentToday = async (companyId, now) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AI_USAGE, data: [{ feature: FEATURES.PROJECT_TRIAGE, at: { $gte: new Date(`${dayOf(now)}T00:00:00.000Z`) } }, 'costUsd'],
    }, 'find').catch(() => []);
    return (rows || []).reduce((sum, row) => sum + Number(row.costUsd || 0), 0);
};

const skipReason = async (companyId, now) => {
    if (!(await aiSwitch.allowed(companyId))) return SKIPPED.AI_OFF;
    if (!isAnyProviderConfigured()) return SKIPPED.NO_PROVIDER;
    const priced = checkConfiguredModelPriced();
    if (!priced.model || !priced.ok) return SKIPPED.UNPRICED;
    if (!(await budget.check(companyId)).ok) return SKIPPED.BUDGET;
    const { monthlyBudgetUsd } = await budget.settings(companyId);
    if (!(monthlyBudgetUsd > 0) && (await spentToday(companyId, now)) >= CAPS.DAILY_USD) return SKIPPED.DAILY_CAP;
    return null;
};

const openTasks = (projectId) => ({ ProjectID: { $in: idForms([String(projectId)]) }, deletedStatusKey: { $ne: 1 }, mainChat: { $ne: true }, statusType: { $nin: CLOSED_STATUS_TYPES } });

/* The cursor is the last triaged createdAt plus the ids already seen at that instant, so tasks sharing it are neither skipped nor repeated. */
const cursorOf = (project, now) => {
    const floor = new Date(new Date(now).getTime() - CAPS.LOOKBACK_DAYS * DAY_MS);
    const at = project.agentManagerTriagedAt ? new Date(project.agentManagerTriagedAt) : null;
    return at && at >= floor ? { since: at, seen: (project.agentManagerTriagedIds || []).map(String) } : { since: floor, seen: [] };
};

const readNew = (companyId, project, cursor) => find(companyId, [
    { ...openTasks(project._id), createdAt: { $gte: cursor.since }, ...(cursor.seen.length ? { _id: { $nin: idForms(cursor.seen) } } : {}) },
    TASK_FIELDS, { sort: { createdAt: 1, _id: 1 }, limit: CAPS.BATCH },
]);

const readNeighbours = (companyId, projectId, batch) => find(companyId, [
    { ...openTasks(projectId), _id: { $nin: batch.map((task) => oid(task._id)) } }, TASK_FIELDS, { sort: { createdAt: -1 }, limit: CAPS.NEIGHBOURS },
]);

const line = (ref, task, withText) => JSON.stringify({
    id: ref, key: keyOf(task), name: clean(task.TaskName, CAPS.NAME),
    ...(withText ? { description: clean(task.rawDescription || task.description, CAPS.TEXT), priority: task.Task_Priority || '', estimated: hasEstimate(task) } : {}),
});

const promptOf = (batch, neighbours) => [
    'New tasks:', ...batch.map((task, i) => line(`n${i + 1}`, task, true)),
    'Other open tasks:', ...neighbours.map((task, i) => line(`o${i + 1}`, task, false)),
].join('\n');

const parsedOrNull = (text) => { try { return JSON.parse(text); } catch (e) { return null; } };

/* A truncated answer still holds every suggestion object that closed before the cut. */
const salvage = (text) => {
    const body = String(text || '');
    const out = [];
    let depth = 0; let from = -1; let inString = false; let escaped = false;
    for (let i = body.indexOf('[') + 1; i > 0 && i < body.length; i += 1) {
        const c = body[i];
        if (inString) {
            if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false;
        } else if (c === '"') inString = true;
        else if (c === '{') { if (depth === 0) from = i; depth += 1; }
        else if (c === '}' && depth > 0) {
            depth -= 1;
            const item = depth === 0 ? parsedOrNull(body.slice(from, i + 1)) : null;
            if (item) out.push(item);
        } else if (c === ']' && depth === 0) break;
    }
    return out.length ? { suggestions: out } : null;
};

/* The model's answer is data: only a listed id, a known priority and a sane whole-minute estimate get through. */
const readSuggestions = (raw, batch, neighbours) => {
    const list = raw && Array.isArray(raw.suggestions) ? raw.suggestions : [];
    const byRef = new Map(batch.map((task, i) => [`n${i + 1}`, task]));
    const others = new Map([...batch.map((task, i) => [`n${i + 1}`, task]), ...neighbours.map((task, i) => [`o${i + 1}`, task])]);
    const seen = new Set();
    const out = [];
    for (const item of list) {
        const ref = item && typeof item.id === 'string' ? item.id : '';
        const task = byRef.get(ref);
        if (!task || seen.has(ref)) continue;
        seen.add(ref);
        const reason = clean(item.reason, CAPS.REASON);
        const priority = typeof item.priority === 'string' ? item.priority.toUpperCase() : '';
        if (PRIORITIES.includes(priority) && priority !== String(task.Task_Priority || '').toUpperCase()) out.push({ kind: KIND.PRIORITY, task, priority, reason });
        const minutes = item.estimateMinutes;
        if (!hasEstimate(task) && Number.isInteger(minutes) && minutes > 0 && minutes <= ESTIMATE_MAX_MINUTES) out.push({ kind: KIND.ESTIMATE, task, minutes, reason });
        const duplicate = typeof item.duplicateOf === 'string' ? others.get(item.duplicateOf) : null;
        if (duplicate && String(duplicate._id) !== String(task._id)) out.push({ kind: KIND.DUPLICATE, task, duplicate, reason });
    }
    return out;
};

const finding = ({ kind, task, priority, minutes, duplicate, reason }) => {
    const taskId = String(task._id);
    const facts = {
        kind, taskKey: keyOf(task), taskName: clean(task.TaskName, CAPS.NAME), reason,
        ...(kind === KIND.PRIORITY ? { priority } : {}),
        ...(kind === KIND.ESTIMATE ? { minutes } : {}),
        ...(kind === KIND.DUPLICATE ? { duplicateKey: keyOf(duplicate), duplicateName: clean(duplicate.TaskName, CAPS.NAME) } : {}),
    };
    const fixes = {
        [KIND.PRIORITY]: () => ({ action: 'task.update', params: { taskId, fields: { Task_Priority: priority } }, label: `Set ${keyOf(task) || 'the task'} to ${priority}`, what: `Set the priority of ${keyOf(task) || 'a task'} to ${priority}` }),
        [KIND.ESTIMATE]: () => ({ action: 'task.update', params: { taskId, fields: { totalEstimatedTime: minutes } }, label: `Estimate ${keyOf(task) || 'the task'} at ${minutes} minutes`, what: `Estimate ${keyOf(task) || 'a task'} at ${minutes} minutes` }),
        [KIND.DUPLICATE]: () => {
            const body = `This may duplicate ${keyOf(duplicate) || 'another task'}: ${clean(duplicate.TaskName, CAPS.NAME)}. Please check before work starts.`;
            return { action: 'task.comment', params: { taskId, body }, label: `Comment on ${keyOf(task) || 'the task'}: "${body}"`, what: `Flag ${keyOf(task) || 'a task'} as a likely duplicate of ${keyOf(duplicate) || 'another task'}` };
        },
    };
    return {
        rule: RULE.TRIAGE, key: `${RULE.TRIAGE}:${taskId}:${kind}`, taskId, taskIds: [taskId, ...(duplicate ? [String(duplicate._id)] : [])], facts,
        fix: { ...fixes[kind](), why: reason || 'Suggested by the project manager from the task text.' },
    };
};

const file = async (companyId, project, suggestions, now) => {
    let filed = 0;
    for (const suggestion of suggestions) {
        const found = finding(suggestion);
        // eslint-disable-next-line no-await-in-loop
        const row = await findings.open(companyId, project._id, found, now, null);
        if (!row) continue;
        filed += 1;
        // eslint-disable-next-line no-await-in-loop
        await filing.propose(companyId, project, row, found);
    }
    return filed;
};

/* A suggestion a person answered is no longer waiting; its row stays so the same suggestion is not made again. */
const settleAnswered = async (companyId, projectId) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECT_FINDINGS, data: [{ projectId: { $in: idForms([String(projectId)]) }, rule: RULE.TRIAGE, status: findings.STATUS.OPEN, proposalId: { $type: 'string' } }],
    }, 'find');
    const ids = (rows || []).map((row) => oid(row.proposalId));
    if (!ids.length) return;
    const decided = new Map(((await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_PROPOSALS, data: [{ _id: { $in: ids } }, { status: 1 }] }, 'find')) || [])
        .map((proposal) => [String(proposal._id), proposal.status]));
    for (const row of rows) {
        const status = decided.get(String(row.proposalId));
        if (!status || status === proposals.STATUS.PENDING) continue;
        const refused = [proposals.STATUS.DECLINED, proposals.STATUS.UNDONE].includes(status);
        // eslint-disable-next-line no-await-in-loop
        await findings.settle(companyId, row, refused ? findings.STATUS.DECLINED : findings.STATUS.HANDLED, new Date());
    }
};

const moveCursor = (companyId, project, batch, cursor) => {
    const at = new Date(batch[batch.length - 1].createdAt);
    const atSame = batch.filter((task) => new Date(task.createdAt).getTime() === at.getTime()).map((task) => String(task._id));
    const carried = cursor.since.getTime() === at.getTime() ? cursor.seen : [];
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(project._id) }, { $set: { agentManagerTriagedAt: at, agentManagerTriagedIds: [...new Set([...carried, ...atSame])] } }],
    }, 'updateOne');
};

/* One model call for the batch. A call that bought tokens moves the cursor even when its answer could not be read, so the batch is never paid for twice;
 * a skip or a call that cost nothing leaves the cursor, and the same tasks are tried again. */
const run = async (companyId, project, now = new Date()) => {
    await settleAnswered(companyId, project._id);
    const reason = await skipReason(companyId, now);
    if (reason) return { skipped: reason };
    const cursor = cursorOf(project, now);
    const batch = await readNew(companyId, project, cursor);
    if (!batch.length) return { skipped: SKIPPED.NO_NEW_TASKS };
    const neighbours = await readNeighbours(companyId, project._id, batch);
    const answer = await askModel(SKILL, {
        prompt: promptOf(batch, neighbours), budget: {}, spend: { feature: FEATURES.PROJECT_TRIAGE, companyId: String(companyId) },
    });
    const raw = answer.raw || salvage(answer.text);
    if (!answer.raw) logger.warn(`${LOG_PREFIX} ${companyId}: project ${project._id} answer unreadable${raw ? ', partly salvaged' : ''}: ${answer.degraded || 'no answer'}`);
    if (!raw && !tokensSpent(answer.usage)) return { skipped: answer.refused ? SKIPPED.BUDGET : SKIPPED.NO_ANSWER };
    await moveCursor(companyId, project, batch, cursor);
    const filed = raw ? await file(companyId, project, readSuggestions(raw, batch, neighbours), now) : 0;
    return { triaged: batch.length, filed, model: answer.model || '', costUsd: answer.usage && answer.usage.costUsd, ...(answer.raw ? {} : { degraded: answer.degraded || 'no answer' }) };
};

const COMPANY_CONCURRENCY = 5;

/* The day's mark is taken before the model is asked, so two servers never both pay for the same batch; it is given back only for a skip that bought nothing. */
const triageAt = async (companyId, project, now) => {
    const week = await workingDaysOf(companyId, String(project._id));
    if (!isWorkingDay(now, week)) return null;
    const today = dayOf(now);
    const claimed = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: oid(project._id), 'agentManager.on': true, agentManagerTriagedOn: { $ne: today } }, { $set: { agentManagerTriagedOn: today } }, { projection: { ProjectName: 1, agentManagerTriagedAt: 1, agentManagerTriagedIds: 1 } }],
    }, 'findOneAndUpdate');
    if (!claimed) return null;
    let result;
    try {
        result = await run(companyId, { ...project, ...claimed }, now);
    } catch (error) {
        result = null;
        logger.error(`${LOG_PREFIX} ${companyId}: project ${project._id} was not triaged: ${error.message || error}`);
    }
    if (!result || result.skipped) {
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(project._id), agentManagerTriagedOn: today }, { $unset: { agentManagerTriagedOn: '' } }] }, 'updateOne').catch(() => {});
    }
    return result;
};

const runForCompany = async (companyId, now = new Date()) => {
    const projects = await find2(companyId, [{ 'agentManager.on': true, agentManagerTriagedOn: { $ne: dayOf(now) }, deletedStatusKey: { $ne: 1 } }, { ProjectName: 1, agentManagerTriagedAt: 1, agentManagerTriagedIds: 1 }]);
    const totals = { triaged: 0, filed: 0 };
    for (const project of projects) {
        // eslint-disable-next-line no-await-in-loop
        const result = await triageAt(companyId, project, now);
        if (result && !result.skipped) { totals.triaged += result.triaged; totals.filed += result.filed; }
    }
    return totals;
};

const runForAllCompanies = async (now = new Date()) => {
    const companies = (await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{}, '_id'] }, 'find')) || [];
    const totals = { triaged: 0, filed: 0 };
    for (let i = 0; i < companies.length; i += COMPANY_CONCURRENCY) {
        // eslint-disable-next-line no-await-in-loop
        const done = await Promise.all(companies.slice(i, i + COMPANY_CONCURRENCY).map((company) => runForCompany(String(company._id), now).catch((error) => {
            logger.error(`${LOG_PREFIX} ${company._id}: ${error.message || error}`);
            return { triaged: 0, filed: 0 };
        })));
        done.forEach((one) => { totals.triaged += one.triaged; totals.filed += one.filed; });
    }
    return totals;
};

module.exports = { KIND, SKIPPED, CAPS, SKILL, run, runForCompany, runForAllCompanies, readSuggestions, salvage, finding };
