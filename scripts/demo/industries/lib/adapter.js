const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../../Config/schemaType');
const { dbCollections, settingsCollectionDocs } = require('../../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../../utils/mongo-handler/mongoQueries');
const { MARK } = require('./guard');
const { markdownBlocks } = require('./blocks');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const GLOBAL = dbCollections.GLOBAL;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
// Marking a record the seed just wrote is not an edit: a comment with a later updatedAt reads "(edited)".
const UNTOUCHED = Object.freeze({ timestamps: false });
const EDITOR_VERSION = '2.30.7';

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : JSON.parse(JSON.stringify(doc || null)));
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const crud = (db, type, data, method) => MongoDbCrudOpration(db, { type, data }, method);
const findOne = (db, type, filter, fields) => crud(db, type, fields ? [filter, fields] : [filter], 'findOne').then(plain);
const find = async (db, type, filter, fields) => ((await crud(db, type, fields ? [filter, fields] : [filter], 'find')) || []).map(plain);

// Several app helpers answer before their last write lands: the project's List sprint, a task's key.
async function waitFor(probe, what, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await probe();
        if (value) return value;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
        await sleep(250);
    }
}

const viaHandler = (handler, { companyId, uid, body, params = {} }) => new Promise((resolve, reject) => {
    const res = {
        status() { return res; },
        json(payload) { return res.send(payload); },
        send(payload) {
            if (payload && payload.status) resolve(payload.data === undefined ? payload : payload.data);
            else reject(new Error((payload && (payload.statusText || payload.message)) || 'The app refused the request.'));
        },
    };
    // `aud` is the company the session token names, which the tenant check of the workflow routes reads.
    Promise.resolve(handler({ headers: { companyid: companyId }, aud: companyId, uid, body, params, query: {} }, res)).catch(reject);
});

const dayFromToday = (days) => {
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    return new Date(noon.getTime() + days * DAY_MS);
};

const editorData = (markdown) => ({ time: Date.now(), version: EDITOR_VERSION, blocks: markdownBlocks(markdown) });

const plainText = (markdown) => String(markdown || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .trim();

/* People */

const findUserByEmail = (email) => findOne(GLOBAL, SCHEMA_TYPE.USERS, { Employee_Email: String(email).toLowerCase() });

async function createUser({ firstName, lastName, email, password, mark = true }) {
    const { addUserMongodbV2 } = require('../../../../Modules/Auth/controller/createUser');
    const created = await addUserMongodbV2({ firstName, lastName, email: String(email).toLowerCase(), password, isInvitation: true });
    const userId = String(created.statusText._id);
    if (mark) await crud(GLOBAL, SCHEMA_TYPE.USERS, [{ _id: userId }, { $set: { demoShowcase: MARK } }], 'updateOne');
    return userId;
}

async function dismissChecklist(userId) {
    const { sanitizeOnboardingPatch } = require('../../../../Modules/Users/helpers/onboardingRules');
    const { update } = sanitizeOnboardingPatch({ dismissed: true });
    await crud(GLOBAL, SCHEMA_TYPE.USERS, [{ _id: userId, demoShowcase: MARK }, update], 'updateOne');
}

async function createCompany({ ownerId, email, name, marker }) {
    const { createFirstCompany } = require('../../../../Modules/Setup/createCompany');
    return createFirstCompany({ userId: ownerId, email, companyName: name, sampleData: false, companyFields: { demoShowcase: marker } });
}

const updateCompanyMarker = ({ companyId, marker }) => crud(GLOBAL, SCHEMA_TYPE.COMPANIES, [
    { _id: oid(companyId), 'demoShowcase.by': MARK },
    { $set: { demoShowcase: marker } },
], 'updateOne');

async function companyRoles(companyId) {
    const doc = await findOne(companyId, SCHEMA_TYPE.SETTINGS, { name: settingsCollectionDocs.ROLES });
    const catalogue = doc && Array.isArray(doc.settings) ? doc.settings : [];
    const named = (name) => catalogue.find((role) => String(role.name || '').trim().toLowerCase() === name);
    const admin = named('admin');
    const member = named('member');
    if (!admin || !member) throw new Error('The company role catalogue has no Admin or Member role.');
    return { admin, member, guest: named('guest') || member };
}

async function designationResolver(companyId) {
    const doc = await findOne(companyId, SCHEMA_TYPE.SETTINGS, { name: settingsCollectionDocs.DESIGNATIONS });
    const catalogue = doc && Array.isArray(doc.settings) ? doc.settings : [];
    return (names = []) => {
        for (const name of names) {
            const hit = catalogue.find((entry) => String(entry.name || '').trim().toLowerCase() === String(name).trim().toLowerCase());
            if (hit) return hit.key;
        }
        return 0;
    };
}

async function addMember({ companyId, userId, email, roleType, designation }) {
    const { updateMemberFunction } = require('../../../../Modules/settings/Members/controller');
    const { addAndRemoveUserInMongodbNotificationCount } = require('../../../../Modules/Auth/controller');
    const { ensureNotificationDefaults } = require('../../../../Modules/notification/defaults');

    await crud(GLOBAL, SCHEMA_TYPE.USERS, [{ _id: userId }, { $addToSet: { AssignCompany: companyId } }], 'updateOne');
    await updateMemberFunction(companyId, {
        companyId, userId, isDelete: false, roleType, status: 2, userEmail: email, designation, linkId: '', sendInvitationTime: Date.now(),
    }, 'save');
    await addAndRemoveUserInMongodbNotificationCount(companyId, userId, 'Add');
    await ensureNotificationDefaults(companyId, userId);
}

/* Statuses and task types: new names join the company catalogue the way the AI project generator adds them. */

const SETTING_DOC = { status: settingsCollectionDocs.TASK_STATUS, type: settingsCollectionDocs.TASK_TYPE };

async function registerInCatalogue(companyId, kind, entries, shape) {
    const { mergeStatusList } = require('../../../../Modules/AIProjectGenerator/orchestrator');
    const doc = await findOne(companyId, dbCollections.SETTINGS, { name: SETTING_DOC[kind] });
    const settings = doc || { settings: [], totalStatus: 0 };
    const { merged, newEntries, finalTotal } = mergeStatusList({ planList: entries, settings, shapeFn: shape });
    if (newEntries.length && doc) {
        await crud(companyId, dbCollections.SETTINGS, [
            { name: SETTING_DOC[kind] },
            { $push: { settings: { $each: newEntries.map(({ _matched, ...rest }) => rest) } }, $set: { totalStatus: finalTotal } },
        ], 'updateOne');
    }
    return merged.map(({ _matched, ...rest }) => rest);
}

const tint = (color) => `${color}35`;

const projectStatuses = (companyId, statuses) => registerInCatalogue(companyId, 'status', statuses, (entry) => ({
    key: entry.key,
    name: entry.name,
    bgColor: tint(entry.color),
    textColor: entry.color,
    type: entry.type,
    statusImage: '',
    isDeleted: true,
}));

const projectTaskTypes = (companyId, types) => registerInCatalogue(companyId, 'type', types, (entry, index) => ({
    key: entry.key,
    name: entry.name,
    value: entry.value || entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    taskImage: 'setting/task_type/task.png',
    taskCount: 0,
    default: index === 0,
    isDeleted: false,
    isEditable: true,
    assignAsTask: false,
    assignAsSubtask: false,
    isAddNewStatus: false,
    iconType: 'library',
    iconValue: `mdi:${entry.icon || 'checkbox-marked-circle'}`,
    iconColor: entry.iconColor || entry.color || '#2F3990',
}));

/* Projects */

const VIEW_KEYS = Object.freeze({
    list: 'ProjectListView', board: 'ProjectKanban', details: 'ProjectDetail', comments: 'Comments', activity: 'ActivityLog',
    workload: 'Workload', dashboard: 'ProjectDashboard', table: 'TableView', calendar: 'Calendar', gantt: 'GanttView', timeline: 'TimelineView', docs: 'DocsView',
});

async function projectViews(companyId, views) {
    const tabs = await find(companyId, dbCollections.PROJECT_TAB_COMPONENTS, {});
    const wanted = [...new Set([...views, 'details', 'activity'])].map((view) => VIEW_KEYS[view] || view);
    const chosen = wanted.map((keyName) => tabs.find((tab) => tab.keyName === keyName)).filter(Boolean);
    if (!chosen.length) throw new Error(`${companyId} has no project views seeded yet`);
    const defaultKey = VIEW_KEYS[views[0]] || chosen[0].keyName;
    const first = chosen.find((tab) => tab.keyName === defaultKey) || chosen[0];
    return {
        ProjectRequiredComponent: chosen.map((tab) => ({ _id: String(tab._id), viewStatus: true, setAsDefault: tab === first })),
        ProjectRequiredDefaultComponent: first.keyName,
    };
}

async function createProject({ companyId, ownerId, project, taskStatusData, taskTypeCounts, memberIds, leadIds, tags }) {
    const { projectRequestFromTemplates } = require('../../../../Modules/Setup/demoProject');
    const { createProject: create } = require('../../../../Modules/createProject/controller');
    const views = await projectViews(companyId, project.views || ['board', 'list']);
    const req = await projectRequestFromTemplates(companyId, ownerId, {
        ProjectName: project.name,
        ProjectCode: project.code,
        TemplateName: project.name,
        AssigneeUserId: [...new Set([ownerId, ...memberIds])],
        LeadUserId: leadIds,
        projectIcon: { type: 'color', data: project.color },
        includeSampleTasks: false,
        taskStatusData,
        taskTypeCounts,
        tagsArray: tags,
        ...views,
    });
    const created = await create(req);
    const projectId = String(created.data._id);
    await waitFor(() => findOne(companyId, SCHEMA_TYPE.SPRINTS, { projectId: oid(projectId) }, { _id: 1 }), `the List sprint of ${project.name}`);
    return projectId;
}

const getProject = (companyId, projectId) => findOne(companyId, SCHEMA_TYPE.PROJECTS, { _id: oid(projectId) });
const listOf = (companyId, projectId) => findOne(companyId, SCHEMA_TYPE.SPRINTS, { projectId: oid(projectId) });

async function describeProject({ companyId, projectId, summary, guide }) {
    const { normaliseGuide } = require('../../../../Modules/AIProjectGenerator/guideController');
    const descriptionBlock = editorData(summary);
    const aiGuide = guide ? normaliseGuide(guide) : null;
    await crud(companyId, SCHEMA_TYPE.PROJECTS, [{ _id: oid(projectId) }, {
        $set: { description: plainText(summary), descriptionBlock, ...(aiGuide ? { aiGuide } : {}) },
    }], 'updateOne');
}

const MONEY = Object.freeze({
    USD: { fieldMoneyCode: 'USD', fieldMoneyName: 'US Dollar', fieldMoneySymbol: '$' },
    EUR: { fieldMoneyCode: 'EUR', fieldMoneyName: 'Euro', fieldMoneySymbol: '€' },
    GBP: { fieldMoneyCode: 'GBP', fieldMoneyName: 'British Pound', fieldMoneySymbol: '£' },
});
const OPTION_COLORS = Object.freeze(['#2F3990', '#1E88E5', '#00897B', '#F59E0B', '#DC2626', '#7C3AED', '#0891B2', '#64748B']);

/* Returns { [fieldKey]: { id, type, options: { label: optionId } } }. */
async function createFields({ companyId, projectId, ownerId, fields }) {
    const { insertCustomFieldPromise } = require('../../../../Modules/CustomField/controller');
    const { fieldInsertFrom } = require('../../../../Modules/CustomField/helpers/fieldWrite');
    const { fieldDefinitionFrom } = require('../../../../Modules/Importers/helpers/clickupFields');
    const { removeCache } = require('../../../../utils/commonFunctions');

    const made = {};
    for (const field of fields) {
        const options = (field.options || []).map((label, index) => ({
            id: `${field.key}${index + 1}`.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12), color: OPTION_COLORS[index % OPTION_COLORS.length], value: label.toLowerCase(), label, selected: false,
        }));
        const draft = {
            fieldTitle: field.title,
            fieldType: field.type,
            fieldDescription: field.description || field.title,
            ...(options.length ? { fieldOptions: options } : {}),
            ...(field.type === 'money' ? MONEY[field.currency || 'USD'] : {}),
        };
        const saved = plain(await insertCustomFieldPromise(fieldInsertFrom(fieldDefinitionFrom(draft, { projectId, userId: ownerId })), 'save', companyId));
        made[field.key] = { id: String(saved._id), type: field.type, options: Object.fromEntries(options.map((option) => [option.label, option.id])) };
    }
    removeCache(`customField:${companyId}`);
    return made;
}

const fieldValue = (made, value) => {
    switch (made.type) {
        case 'dropdown': return made.options[value] ? [made.options[value]] : [];
        case 'date': return dayFromToday(Number(value)).toISOString();
        case 'checkbox': return Boolean(value);
        case 'number':
        case 'money': return String(value);
        default: return String(value);
    }
};

const fieldValues = (madeFields, values = {}) => Object.fromEntries(Object.entries(values)
    .filter(([key]) => madeFields[key])
    .map(([key, value]) => {
        const id = madeFields[key].id;
        return [id, { fieldValue: fieldValue(madeFields[key], value), _id: id }];
    }));

/* Tasks */

const statusFields = (status) => ({ status: { text: status.name, key: status.key, type: status.type }, statusKey: status.key, statusType: status.type });

async function createTask({ companyId, project, list, actor, ownerId, task, status, taskType, assigneeIds, leaderId, parentId, tagIds, customField }) {
    const { taskMongo } = require('../../../../Modules/Tasks/helpers/task_class_Mongo');
    const description = task.description ? editorData(task.description) : null;
    const due = Number.isFinite(task.due) ? dayFromToday(task.due).toISOString() : '';
    const start = Number.isFinite(task.start) ? dayFromToday(task.start).toISOString() : '';
    const listId = String(list._id);
    const data = {
        _id: String(new mongoose.Types.ObjectId()),
        TaskName: task.name,
        TaskKey: '-',
        description: task.description ? plainText(task.description) : '',
        rawDescription: task.description ? plainText(task.description) : '',
        ...(description ? { descriptionBlock: description } : {}),
        AssigneeUserId: assigneeIds,
        watchers: [...new Set([leaderId, ...assigneeIds])],
        DueDate: due,
        dueDateDeadLine: due ? [{ date: due }] : [],
        ...(start ? { startDate: start } : {}),
        TaskType: taskType.value,
        TaskTypeKey: taskType.key,
        ParentTaskId: parentId || '',
        isParentTask: !parentId,
        ProjectID: String(project._id),
        CompanyId: companyId,
        ...statusFields(status),
        Task_Leader: leaderId,
        Task_Priority: task.priority || 'MEDIUM',
        sprintId: listId,
        sprintArray: { ...plain(list), id: listId },
        ...(tagIds && tagIds.length ? { tagsArray: tagIds } : {}),
        ...(customField && Object.keys(customField).length ? { customField } : {}),
        ...(Array.isArray(task.checklist) && task.checklist.length ? { checklistArray: checklistOf(task.checklist, assigneeIds) } : {}),
        ...(Number.isFinite(task.estimate) ? { totalEstimatedTime: Math.round(task.estimate * 60) } : {}),
        deletedStatusKey: 0,
    };
    const result = await taskMongo.create({
        data,
        user: { Employee_Name: actor.Employee_Name, id: actor.id, companyOwnerId: ownerId },
        projectData: project,
        indexObj: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: String(status.key) },
    });
    if (!result || !result.status) throw new Error(`Task "${task.name}" was not created: ${(result && (result.statusText || result.message)) || 'unknown error'}`);
    await waitFor(async () => {
        const saved = await findOne(companyId, SCHEMA_TYPE.TASKS, { _id: oid(data._id) }, { TaskKey: 1 });
        return Boolean(saved && saved.TaskKey && saved.TaskKey !== '-');
    }, `the key of "${task.name}"`);
    return data._id;
}

const checklistOf = (items, assigneeIds) => items.map((item, index) => {
    const entry = typeof item === 'string' ? { text: item } : item;
    return {
        id: `c${Date.now().toString(36)}${index}`,
        name: entry.text,
        isChecked: Boolean(entry.done),
        isExpand: false,
        AssigneeUserId: assigneeIds.slice(0, 1),
    };
});

async function relate({ companyId, taskId, blockedById, actor }) {
    const { taskMongo } = require('../../../../Modules/Tasks/helpers/task_class_Mongo');
    return taskMongo.addTaskRelation({ companyId, taskId, relatedTaskId: blockedById, type: 'blocked_by', userData: actor });
}

async function moveTask({ companyId, project, taskId, status, actor }) {
    const { taskMongo } = require('../../../../Modules/Tasks/helpers/task_class_Mongo');
    const task = await findOne(companyId, SCHEMA_TYPE.TASKS, { _id: oid(taskId) });
    const held = task.status || {};
    const out = await taskMongo.updateStatus({
        newStatus: statusFields(status),
        prevStatus: { taskId: String(taskId), statusName: held.text || '', updatedTaskName: status.name },
        projectData: { _id: String(project._id), CompanyId: companyId, ProjectName: project.ProjectName },
        task: { _id: String(taskId), sprintId: task.sprintId, folderObjId: task.folderObjId || '', statusType: task.statusType || '', status: held },
        userData: actor,
        isUpdateTask: true,
    });
    if (!out || !out.status) throw new Error(`"${task.TaskName}" could not move to ${status.name}.`);
}

/* A comment a person posts, through the comment route itself. */
async function personComment({ companyId, project, taskId, userId, text }) {
    const controller = require('../../../../Modules/Comments/controller');
    const task = await findOne(companyId, SCHEMA_TYPE.TASKS, { _id: oid(taskId) }, { sprintId: 1 });
    const saved = await viaHandler(controller.save, {
        companyId,
        uid: userId,
        body: { data: { project: false, projectId: String(project._id), taskId: String(taskId), sprintId: String(task.sprintId), userId, type: 'text', message: text, isDeleted: false } },
    });
    return saved && saved._id ? String(saved._id) : null;
}

/* Agents */

async function createRoleAgents({ companyId, roleKeys, projectIds, ownerId }) {
    const packAgents = require('../../../../Modules/AssignmentRules/dispatcher/packAgents');
    const out = await packAgents.create(companyId, roleKeys, projectIds, ownerId);
    return [...out.made, ...out.kept];
}

async function createSkillAgent({ companyId, ownerId, agent, projectIds }) {
    const { createAgentRecord } = require('../../../../Modules/Agents/agentRecord');
    const skillRecord = require('../../../../Modules/Agents/skillRecord');
    const { effectiveActions } = require('../../../../Modules/Agents/skills/effectiveActions');
    const { normaliseSkill } = require('../../../../Modules/Agents/controller');
    const skill = normaliseSkill(agent.skill);
    const problems = await skillRecord.checkAgentSkills(companyId, [skill]);
    if (problems.length) throw new Error(`${agent.name}: ${problems.map((p) => p.message).join('; ')}`);
    const saved = await createAgentRecord(companyId, {
        name: agent.name,
        description: agent.description,
        skills: [skill],
        allowedActions: effectiveActions(null, await skillRecord.getSkill(companyId, skill.key)),
        projectIds,
        // "Acts, you approve the rest": its only action is a low-risk comment, so the digest posts when a visitor runs it.
        autonomy: 2,
        spendCapUsd: agent.spendCapUsd || 2,
    }, { ownerId });
    return { agentId: String(saved._id), name: saved.name };
}

/* What a role agent the demo shows may do: its playbook's actions, plus what its seeded proposals change, so the
 * visitor's approval applies them. A spend cap keeps an agent someone switches on in a public demo cheap. */
async function configureAgent({ companyId, agentId, name, actions, spendCapUsd }) {
    await crud(companyId, SCHEMA_TYPE.AGENTS, [{ _id: oid(agentId) }, {
        $addToSet: { allowedActions: { $each: actions } },
        $set: { spendCapUsd, ...(name ? { name } : {}) },
    }], 'updateOne');
}

const agentById = (companyId, agentId) => findOne(companyId, SCHEMA_TYPE.AGENTS, { _id: oid(agentId) });

const stepsOf = (nodes, startedAt, durationMs) => {
    const each = Math.max(400, Math.round(durationMs / nodes.length));
    return nodes.map((node, index) => {
        const begin = new Date(startedAt.getTime() + index * each);
        return { node, startedAt: begin, endedAt: new Date(begin.getTime() + each), durationMs: each, status: 'ok', tokens: 0, costUsd: 0 };
    });
};

/* A run that did not happen: written so the agent's history shows its work, marked simulated, with no spend. */
async function simulatedRun({ companyId, agent, taskId, projectId, minutesAgo, outcome, waiting, decisions, actions }) {
    const startedAt = new Date(Date.now() - minutesAgo * MINUTE_MS);
    const elapsedMs = 6000 + (minutesAgo % 7) * 1300;
    const nodes = waiting ? ['gather', 'analyse', 'review', 'propose', 'hold'] : ['gather', 'analyse', 'review', 'act', 'remember'];
    const skill = (agent.skills && agent.skills[0] && agent.skills[0].key) || null;
    const saved = await crud(companyId, SCHEMA_TYPE.AGENT_RUNS, {
        agentId: String(agent._id),
        agentName: agent.name,
        simulated: true,
        taskId: String(taskId),
        projectId: String(projectId),
        skill,
        trigger: 'manual',
        status: waiting ? 'waiting_approval' : 'done',
        viaAccount: 'workspace',
        startedAt,
        ...(waiting ? {} : { finishedAt: new Date(startedAt.getTime() + elapsedMs) }),
        elapsedMs,
        spend: { tokens: 0, usd: 0, model: null, billedToWorkspace: false },
        reservedUsd: 0,
        actions: actions || [],
        proposals: [],
        refusals: 0,
        decisions: decisions || [],
        outcome,
        steps: stepsOf(nodes, startedAt, elapsedMs),
    }, 'save');
    return plain(saved);
}

async function agentComment({ companyId, agent, taskId, runId, actingUserId, text }) {
    const tools = require('../../../../Modules/Automations/engine/tools');
    const out = await tools.addComment(companyId, String(taskId), text, {
        actorType: 'agent', agentId: String(agent._id), agentName: agent.name, runId: String(runId), actingUserId, userId: String(agent._id), viaAccount: 'workspace',
    });
    if (out.commentId) await crud(companyId, SCHEMA_TYPE.COMMENTS, [{ _id: oid(out.commentId) }, { $set: { simulated: true } }, UNTOUCHED], 'updateOne');
    return out.commentId;
}

async function simulatedProposal({ companyId, agent, run, taskId, projectId, what, why, changes, priority }) {
    const proposals = require('../../../../Modules/Agents/proposals');
    const saved = plain(await proposals.create(companyId, { agent, runId: String(run._id), taskId: String(taskId), projectId: String(projectId), what, why, changes, priority }));
    await crud(companyId, SCHEMA_TYPE.AGENT_PROPOSALS, [{ _id: oid(saved._id) }, { $set: { simulated: true } }, UNTOUCHED], 'updateOne');
    await crud(companyId, SCHEMA_TYPE.AGENT_RUNS, [{ _id: oid(run._id) }, { $set: { proposals: [String(saved._id)] } }, UNTOUCHED], 'updateOne');
    return String(saved._id);
}

/* Automations: saved through the rule route; run for real in this process by the app's own engine. */

async function createRule({ companyId, ownerId, rule }) {
    const controller = require('../../../../Modules/Automations/controller');
    const saved = await viaHandler(controller.createRuleV2, { companyId, uid: ownerId, body: { ...rule, enabled: true } });
    return String(saved._id || saved.id);
}

async function startAutomations() {
    process.env.AUTOMATION_QUEUE_DRIVER = 'inline';
    const domainEventBus = require('../../../../event/domainEventBus');
    const engine = require('../../../../Modules/Automations/engine');
    if (!engine.enabled()) return false;
    domainEventBus.start();
    await engine.start();
    return true;
}

async function stopAutomations() {
    const engine = require('../../../../Modules/Automations/engine');
    await engine.stop();
    // Stopped, the in-process queue has no handlers left; without a driver, a workflow run started later ticks in
    // process (Modules/Workflows/queue.js), as on an instance that never started the engine.
    engine._setDriver(null);
}

// The event bus holds a task's emits for 2 seconds (DEBOUNCE_MS in event/domainEventBus.js) before a rule sees them,
// so a move near the end of a story has no run to count yet; stopping the engine then would drop it.
const EVENT_WINDOW_MS = 3000;

async function settleAutomations(companyId, since, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    await sleep(EVENT_WINDOW_MS);
    for (;;) {
        await sleep(1000);
        const open = await crud(companyId, SCHEMA_TYPE.AUTOMATION_RUNS, [{ createdAt: { $gte: since }, status: { $in: ['queued', 'running', 'retrying'] } }], 'countDocuments');
        if (!Number(open) || Date.now() > deadline) break;
    }
    return find(companyId, SCHEMA_TYPE.AUTOMATION_RUNS, { createdAt: { $gte: since } }, { ruleName: 1, status: 1 });
}

const features = () => ({
    dispatcher: require('../../../../Modules/AssignmentRules/dispatcher/flag').enabled(),
    workflows: require('../../../../Modules/Workflows/flag').roleHandoffSteps(),
});

async function saveDispatcher({ companyId, projectId, userId, settings }) {
    const controller = require('../../../../Modules/AssignmentRules/dispatcher/controller');
    return viaHandler(controller.saveSettings, { companyId, uid: userId, params: { projectId: String(projectId) }, body: settings });
}

/* The dispatcher's own routing of one task, as a task event would start it; its rules only, no model. */
const routeTask = ({ companyId, taskId }) => require('../../../../Modules/AssignmentRules/dispatcher/gate').route({ companyId, taskId: String(taskId), trigger: 'create' });

async function acceptSuggestion({ companyId, taskId, actor }) {
    const decisions = require('../../../../Modules/AssignmentRules/dispatcher/decisions');
    const { decision } = await decisions.forTask(companyId, actor.id, String(taskId));
    if (!decision || decision.state !== 'suggested') throw new Error(`Task ${taskId} has no routing suggestion to accept.`);
    return decisions.accept(companyId, actor, String(taskId), decision._id);
}

const workflowRoutes = () => require('../../../../Modules/Workflows/controller');

async function installTemplate({ companyId, userId, key }) {
    const saved = await viaHandler(workflowRoutes().installTemplate, { companyId, uid: userId, params: { key } });
    return String(plain(saved)._id);
}

async function createWorkflow({ companyId, userId, definition }) {
    const saved = await viaHandler(workflowRoutes().createDefinition, { companyId, uid: userId, body: definition });
    return String(plain(saved)._id);
}

const enableWorkflow = ({ companyId, userId, definitionId }) => viaHandler(workflowRoutes().setDefinitionEnabled, {
    companyId, uid: userId, params: { id: String(definitionId) }, body: { enabled: true },
});

async function startWorkflow({ companyId, userId, definitionId, taskId, projectId, name }) {
    const started = await viaHandler(workflowRoutes().startRun, {
        companyId, uid: userId, body: { definitionId: String(definitionId), taskId: String(taskId), projectId: String(projectId), name },
    });
    return String(plain(started.run)._id);
}

/* What a role does when it finishes a hand-over (the write `queue.release` makes with `finished`), done by the seed
 * because no agent ran: the queue row, the step and its run are marked simulated. The engine then moves on. */
async function finishHandOver({ companyId, runId, stepId, finishedBy }) {
    const store = require('../../../../Modules/Workflows/store');
    const engine = require('../../../../Modules/Workflows/engine');
    const findings = require('../../../../Modules/Agents/manager/findings');
    const run = plain(await store.getRun(companyId, runId));
    const step = ((await store.listSteps(companyId, runId)) || []).map(plain).find((one) => one.stepId === stepId);
    if (!step || step.type !== 'role_handoff' || step.status !== 'pending' || !step.handedAt) {
        throw new Error(`${run.name}: step ${stepId} is not waiting for its role (${step ? step.status : 'missing'}${step && step.error ? `: ${step.error}` : ''}).`);
    }
    const taskId = (step.config && step.config.taskId) || run.taskId;
    const now = new Date();
    const finished = await crud(companyId, SCHEMA_TYPE.PROJECT_FINDINGS, [
        { key: `${findings.HANDED_OVER}:${taskId}`, status: findings.STATUS.OPEN, 'facts.role': step.config.role },
        { $unset: { claim: '' }, $set: { status: findings.STATUS.CLOSED, closedAt: now, leftQueue: { why: findings.LEFT.FINISHED, userId: '', name: finishedBy, at: now, simulated: true } } },
    ], 'updateOne');
    if (!finished || !finished.modifiedCount) throw new Error(`${run.name}: ${step.config.role} holds no queue row for step ${stepId}.`);
    await crud(companyId, SCHEMA_TYPE.WORKFLOW_STEP_RUNS, [{ runId: String(runId), stepId }, { $set: { simulated: true } }, UNTOUCHED], 'updateOne');
    await crud(companyId, SCHEMA_TYPE.WORKFLOW_RUNS, [{ _id: oid(runId) }, { $set: { simulated: true } }, UNTOUCHED], 'updateOne');
    await store.wakeStep(companyId, runId, stepId);
    await engine.tick(companyId, String(runId), {});
}

const waitingApproval = ({ companyId, runId }) => findOne(companyId, SCHEMA_TYPE.WORKFLOW_APPROVALS, { runId: String(runId), status: 'pending' });

/* Goals, dashboard, guide */

async function createGoal({ companyId, ownerId, goal }) {
    const { saveGoal } = require('../../../../Modules/Goals/controller');
    const caller = { companyId, uid: String(ownerId), isGuest: false, isPrivileged: true };
    return saveGoal(caller, { visibility: 'workspace', ...goal });
}

async function createDashboard({ companyId, ownerId, projectId, dashboard }) {
    const { makeDashboard } = require('../../../../Modules/AIProjectGenerator/planDashboard');
    return makeDashboard({ companyId, uid: String(ownerId), projectId: String(projectId), dashboard });
}

async function createGuidePage({ companyId, ownerId, projectId, title, markdown }) {
    const { savePage } = require('../../../../Modules/Pages/controller');
    const saved = await savePage(companyId, String(ownerId), {
        title,
        projectId: String(projectId),
        contentBlocks: markdownBlocks(markdown),
    });
    if (saved.refused) throw new Error(saved.refused);
    return String(saved.created._id);
}

/* Removal */

async function dropCompany(companyId) {
    const { dropCompanyDatabase } = require('../../../../utils/mongo-handler/mongoQueries');
    await dropCompanyDatabase(String(companyId));
    fs.rmSync(path.join(ROOT, 'storage', String(companyId)), { recursive: true, force: true });
}

const globalWrite = (type, method, ...data) => crud(GLOBAL, type, data, method);

module.exports = {
    GLOBAL,
    plain,
    oid,
    sleep,
    find,
    findOne,
    findUserByEmail,
    createUser,
    dismissChecklist,
    createCompany,
    updateCompanyMarker,
    companyRoles,
    designationResolver,
    addMember,
    projectStatuses,
    projectTaskTypes,
    createProject,
    getProject,
    listOf,
    describeProject,
    createFields,
    fieldValues,
    createTask,
    relate,
    moveTask,
    personComment,
    createRoleAgents,
    createSkillAgent,
    configureAgent,
    agentById,
    simulatedRun,
    agentComment,
    simulatedProposal,
    createRule,
    startAutomations,
    stopAutomations,
    settleAutomations,
    features,
    saveDispatcher,
    routeTask,
    acceptSuggestion,
    installTemplate,
    createWorkflow,
    enableWorkflow,
    startWorkflow,
    finishHandOver,
    waitingApproval,
    createGoal,
    createDashboard,
    createGuidePage,
    dropCompany,
    globalWrite,
};
