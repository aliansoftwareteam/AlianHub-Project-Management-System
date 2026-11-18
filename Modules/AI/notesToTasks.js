'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const config = require('../../Config/config');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { tenantOf, TenantError } = require('../../Config/tenant');
const { evaluatePermission, isWritable } = require('../../Config/permissionGuard');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { activeMemberIds, memberProfiles } = require('../../utils/companyMembers');
const socketEmitter = require('../../event/socketEventEmitter');
const { visibleProjects, visibleProjectIds } = require('../Agents/scope');
const aiSwitch = require('../AICore/aiSwitch');
const untrusted = require('../AICore/untrusted');
const { FEATURES } = require('../AICore/features');
const { getProvider, isAnyProviderConfigured } = require('../AICore/llmProvider');
const { canUsePage } = require('../Pages/helpers/pageAccess');
const { htmlToRawText } = require('../Pages/helpers/pageRules');
const { contentToEditorData, blocksToRawText } = require('../Pages/helpers/pageContent');
const { emitPageChange } = require('../Pages/helpers/pageEvents');
const { TASK_ACTION_FIELDS, TaskWriteRefusal, prepareTaskRequest, sessionActor } = require('../Tasks/helpers/taskWriteFields');

const KINDS = ['call', 'page'];
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TEXT_CAP = 40_000;
const TITLE_CAP = 250;
const MAX_ITEMS = 12;
const MAX_PROJECTS = 200;
const MAX_MEMBERS = 500;
const REQUEST_TIMEOUT_MS = 120_000;
const UNDO_WINDOW_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = [
    ['sun', 'sunday'], ['mon', 'monday'], ['tue', 'tues', 'tuesday'], ['wed', 'wednesday'],
    ['thu', 'thur', 'thurs', 'thursday'], ['fri', 'friday'], ['sat', 'saturday'],
];

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'action-items.md'), 'utf8')
    .replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();

const isId = (value) => OBJECT_ID.test(String(value || ''));
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const clamp = (value, cap) => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length <= cap ? text : text.slice(0, cap);
};
const escapeHtml = (text) => String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

class Refusal extends Error {
    constructor(statusCode, message, extra = {}) {
        super(message);
        this.statusCode = statusCode;
        this.extra = extra;
    }
}

/* A due date as the model or the notes wrote it, read against the day the notes were taken. Anything
 * vaguer than a date or a weekday stays text for the person to settle in the preview. */
function parseDue(value, reference = new Date()) {
    const text = String(value || '').trim().toLowerCase().replace(/\.$/, '');
    if (!text) return '';
    const iso = text.match(ISO_DAY);
    if (iso) {
        const day = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
        return day.toISOString().slice(0, 10) === text ? text : '';
    }
    const ref = reference instanceof Date && !Number.isNaN(reference.getTime()) ? reference : new Date();
    const base = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
    const shift = (days) => new Date(base + days * DAY_MS).toISOString().slice(0, 10);
    if (text === 'today') return shift(0);
    if (text === 'tomorrow') return shift(1);
    const weekday = WEEKDAYS.findIndex((names) => names.includes(text));
    if (weekday === -1) return '';
    return shift(((weekday - new Date(base).getUTCDay() + 7) % 7) || 7);
}

const webLink = (route) => `${String(config.WEBURL || '').replace(/\/+$/, '')}/#/${route}`;

const participantIds = (participants) => (Array.isArray(participants) ? participants : [])
    .map((p) => (p && typeof p === 'object' ? p.userId || p.id : p))
    .map(String)
    .filter(isId);

const pageText = (page) => page.rawText
    || htmlToRawText((page.content && page.content.html) || '')
    || blocksToRawText(contentToEditorData(page.content));

/* The notes or page, re-read and re-checked on every request: a participant's own call notes, or a
 * page the caller can open. Anything else answers as not found. */
async function loadSource(companyId, uid, kind, id) {
    if (!KINDS.includes(kind) || !isId(id)) throw new Refusal(400, 'A call notes or page id is required.');
    if (kind === 'call') {
        const doc = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.CALLS,
            data: [{ _id: oid(id), participants: String(uid), deletedStatusKey: { $ne: 1 } }],
        }, 'findOne');
        if (!doc) throw new Refusal(404, 'Notes not found.');
        return {
            kind,
            doc,
            title: doc.title || '',
            text: doc.transcript || doc.summary || '',
            projectId: isId(doc.projectId) ? String(doc.projectId) : '',
            fixedProject: false,
            candidateIds: participantIds(doc.participants),
            link: webLink(`${companyId}/chat-notes/${id}`),
            linkLabel: 'Meeting notes',
            reference: doc.createdAt || doc.endedAt || new Date(),
        };
    }
    const doc = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PAGES, data: [{ _id: oid(id), deletedStatusKey: 0 }],
    }, 'findOne');
    if (!doc || !(await canUsePage(companyId, doc, uid))) throw new Refusal(404, 'Page not found.');
    return {
        kind,
        doc,
        title: doc.title || '',
        text: pageText(doc),
        projectId: doc.ProjectID ? String(doc.ProjectID) : '',
        fixedProject: Boolean(doc.ProjectID),
        candidateIds: null,
        link: webLink(`${companyId}/pages/${id}`),
        linkLabel: 'Doc',
        reference: new Date(),
    };
}

const writable = async (companyId, uid, key, projectId) => {
    try {
        return isWritable(await evaluatePermission(companyId, String(uid), key, { projectId }));
    } catch (_e) {
        return false;
    }
};

async function creatableProjects(companyId, uid) {
    const visible = ((await visibleProjects(companyId, String(uid))) || []).slice(0, MAX_PROJECTS);
    const allowed = await Promise.all(visible.map((p) => writable(companyId, uid, 'task.task_create', String(p._id))));
    return visible.filter((_, index) => allowed[index]).map((p) => ({ id: String(p._id), name: p.ProjectName || '' }));
}

async function activeMembers(companyId) {
    const seats = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS, data: [{ ...ACTIVE_SEAT }, { userId: 1 }, { limit: MAX_MEMBERS }],
    }, 'find');
    return (seats || []).map((seat) => String(seat.userId)).filter(isId);
}

async function profilesOf(companyId, ids) {
    const active = await activeMemberIds(companyId, ids);
    if (!active.length) return [];
    const profiles = await memberProfiles(companyId, active, { Employee_Name: 1 });
    const names = Object.fromEntries((profiles || []).map((p) => [String(p._id), p.Employee_Name || '']));
    return active.map((id) => ({ id, name: names[id] || '' }));
}

const withProjects = (companyId, people, creatableIds) => Promise.all(people.map(async (person) => {
    const opens = new Set(((await visibleProjectIds(companyId, person.id)) || []).map(String));
    return { ...person, projectIds: creatableIds.filter((pid) => opens.has(pid)) };
}));

const nameKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

/* The one person a written name points at, by full name and then by first name; a name two
 * people share points at nobody. */
function matchOwner(written, people) {
    const wanted = nameKey(written);
    if (!wanted) return '';
    const full = people.filter((p) => nameKey(p.name) === wanted);
    if (full.length === 1) return full[0].id;
    const first = wanted.split(' ')[0];
    const byFirst = people.filter((p) => nameKey(p.name).split(' ')[0] === first);
    return byFirst.length === 1 ? byFirst[0].id : '';
}

/* Fresh keys per extraction, so a new item never takes over one the notes already hold. */
function parseItems(raw, batch = Date.now().toString(36)) {
    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch (_e) {
        const match = String(raw || '').match(/\{[\s\S]*\}/);
        if (!match) return null;
        try { parsed = JSON.parse(match[0]); } catch (_err) { return null; }
    }
    const items = parsed && Array.isArray(parsed.actionItems) ? parsed.actionItems : null;
    if (!items) return null;
    return items
        .filter((item) => item && typeof item.title === 'string' && item.title.trim())
        .slice(0, MAX_ITEMS)
        .map((item, index) => ({ key: `n${batch}_${index + 1}`, title: clamp(item.title, TITLE_CAP), owner: clamp(item.owner, 80), due: clamp(item.due, 40) }));
}

async function extractItems({ companyId, uid, source }) {
    const text = clamp(source.text, TEXT_CAP);
    if (!text) throw new Refusal(400, 'There is nothing to read in this source yet.');
    await aiSwitch.assertAllowed(companyId);
    if (!isAnyProviderConfigured()) throw new Refusal(200, 'No AI provider is configured.', { isNotAi: true });

    const today = (source.reference instanceof Date ? source.reference : new Date(source.reference || Date.now()));
    const header = [
        `Source: ${source.kind === 'call' ? 'call notes' : 'document'}`,
        source.title ? `Title: ${clamp(source.title, 200)}` : '',
        `Today: ${today.toISOString().slice(0, 10)}`,
    ].filter(Boolean).join('\n');

    let timer = null;
    try {
        const result = await Promise.race([
            getProvider().chat({
                systemPrompt: untrusted.withNotice(SYSTEM_PROMPT),
                messages: [{ role: 'user', content: `${header}\n\n${untrusted.wrap(text)}` }],
                jsonMode: true,
                temperature: 0.2,
                maxTokens: 2048,
                spend: { feature: FEATURES.ACTION_ITEMS, companyId, userId: String(uid) },
            }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The AI request timed out.')), REQUEST_TIMEOUT_MS); }),
        ]);
        const items = result && typeof result.content === 'string' ? parseItems(result.content) : null;
        if (!items) throw new Refusal(200, 'The AI returned nothing usable.');
        return items;
    } finally {
        clearTimeout(timer);
    }
}

const storedItems = (source) => (source.kind === 'call' && Array.isArray(source.doc.actionItems) ? source.doc.actionItems : []);

async function propose({ companyId, uid, kind, id, projectId, refresh }) {
    const source = await loadSource(companyId, uid, kind, id);
    const extracted = storedItems(source);
    const fromNotes = !refresh && extracted.length > 0;
    const raw = fromNotes
        ? extracted.filter((item) => item && !item.taskId && item.title).map((item, index) => ({
            key: String(item.id || `ai_${index + 1}`), title: clamp(item.title, TITLE_CAP), owner: clamp(item.owner, 80), due: clamp(item.due, 40),
        }))
        : await extractItems({ companyId, uid, source });

    let projects = await creatableProjects(companyId, uid);
    if (source.fixedProject) projects = projects.filter((p) => p.id === source.projectId);
    const creatableIds = projects.map((p) => p.id);
    const chosen = [String(projectId || ''), source.projectId].find((pid) => pid && creatableIds.includes(pid))
        || (!source.fixedProject && creatableIds.length === 1 ? creatableIds[0] : '');

    const candidates = source.candidateIds || await activeMembers(companyId);
    const profiles = await profilesOf(companyId, [...new Set([...candidates, String(uid)])]);
    const matches = raw.map((item) => matchOwner(item.owner, profiles));
    const shown = source.candidateIds ? profiles : profiles.filter((p) => p.id === String(uid) || matches.includes(p.id));
    const people = await withProjects(companyId, shown, creatableIds);
    const items = raw.map((item, index) => {
        const person = people.find((p) => p.id === matches[index]);
        const ownerId = person && (!chosen || person.projectIds.includes(chosen)) ? person.id : '';
        return { key: item.key, title: item.title, ownerId, ownerName: item.owner, due: parseDue(item.due, source.reference), dueText: item.due };
    });

    return {
        items,
        people,
        projects,
        projectId: chosen,
        fixedProject: source.fixedProject,
        fromNotes,
        allCreated: fromNotes && !items.length,
    };
}

async function firstList(companyId, project, sprintId) {
    if (isId(sprintId)) {
        const sprint = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: oid(sprintId), deletedStatusKey: { $in: [0, null] } }] }, 'findOne');
        const owner = sprint && (sprint.projectId || sprint.ProjectID);
        if (!sprint || String(owner) !== String(project._id)) throw new Refusal(400, 'That list is not in this project.');
        return sprint;
    }
    const lists = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{ $or: [{ projectId: project._id }, { projectId: String(project._id) }], deletedStatusKey: { $in: [0, null] } }, {}, { sort: { createdAt: 1 }, limit: 1 }],
    }, 'find');
    if (!Array.isArray(lists) || !lists.length) throw new Refusal(400, 'This project has no list to add tasks to.');
    return lists[0];
}

async function folderNameOf(companyId, folderId) {
    if (!isId(folderId)) return '';
    const folder = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.FOLDERS, data: [{ _id: oid(folderId) }, { name: 1 }] }, 'findOne').catch(() => null);
    return (folder && folder.name) || '';
}

function cleanItems(items) {
    if (!Array.isArray(items) || !items.length) throw new Refusal(400, 'Tick at least one item.');
    if (items.length > MAX_ITEMS * 2) throw new Refusal(400, 'Too many items at once.');
    return items.map((item, index) => {
        const title = clamp(item && item.title, TITLE_CAP);
        if (title.length < 3) throw new Refusal(400, 'Every task needs a title of at least 3 characters.');
        return {
            key: clamp(item.key, 40) || `item_${index + 1}`,
            title,
            ownerId: isId(item.ownerId) ? String(item.ownerId) : '',
            due: ISO_DAY.test(String(item.due || '')) ? parseDue(item.due) : '',
        };
    });
}

/* Owners must be people the source could name — the call's participants, or any member for a page —
 * who hold a live seat and can open the project. Anyone else is left off rather than refusing the task. */
async function ownersAllowed(companyId, source, ownerIds, projectId) {
    const named = [...new Set(ownerIds.filter(Boolean))]
        .filter((id) => !source.candidateIds || source.candidateIds.includes(id));
    const active = await activeMemberIds(companyId, named);
    const opens = await Promise.all(active.map(async (id) => ((await visibleProjectIds(companyId, id)) || []).map(String).includes(projectId)));
    return new Set(active.filter((_, index) => opens[index]));
}

const takeTaskMongo = () => require('../Tasks/helpers/task_class_Mongo').taskMongo;

async function recordOnSource(companyId, source, created) {
    if (!created.length) return;
    if (source.kind === 'page') {
        const linked = [...new Set([...(source.doc.linkedTasks || []).map(String), ...created.map((c) => c.taskId)])];
        const page = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{ _id: source.doc._id }, { $set: { linkedTasks: linked.map(oid) } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (page) emitPageChange(companyId, 'update', page);
        return;
    }
    const byKey = new Map(created.map((c) => [c.key, c]));
    const existing = storedItems(source);
    const next = existing.map((item) => {
        const made = byKey.get(String(item && item.id));
        if (!made) return item;
        byKey.delete(made.key);
        return { ...item, taskId: made.taskId, projectId: made.projectId, sprintId: made.sprintId };
    });
    byKey.forEach((made) => next.push({
        id: made.key, title: made.title, owner: made.ownerName || '', due: made.due || '', at: '', done: false,
        taskId: made.taskId, projectId: made.projectId, sprintId: made.sprintId, taskUrl: '',
    }));
    await saveCallItems(companyId, source, next);
}

async function saveCallItems(companyId, source, actionItems) {
    const updated = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.CALLS,
        data: [{ _id: source.doc._id }, { $set: { actionItems } }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    if (!updated) return;
    try {
        socketEmitter.emit('update', { type: 'update', data: updated, module: 'calls', companyId: String(companyId) });
    } catch (error) {
        logger.error(`notesToTasks emit: ${error.message}`);
    }
}

async function createTasks(req, { companyId, uid, kind, id, projectId, sprintId, items }) {
    const source = await loadSource(companyId, uid, kind, id);
    const wanted = cleanItems(items);
    const targetId = source.fixedProject ? source.projectId : String(projectId || '');
    if (!isId(targetId)) throw new Refusal(400, 'Pick a project for these tasks.');
    const canCreate = ((await visibleProjectIds(companyId, String(uid))) || []).map(String).includes(targetId)
        && await writable(companyId, uid, 'task.task_create', targetId);
    if (!canCreate) throw new Refusal(403, 'You cannot add tasks to this project.');

    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(targetId), deletedStatusKey: { $ne: 1 } }],
    }, 'findOne');
    if (!project) throw new Refusal(404, 'Project not found.');
    const status = (project.taskStatusData || []).map((row) => (row && row.convertStatus ? row.convertStatus : row)).find((s) => s && s.type === 'default_active');
    const taskType = (project.taskTypeCounts || [])[0];
    if (!status || !taskType) throw new Refusal(400, 'This project is not ready for tasks yet.');

    const list = await firstList(companyId, project, sprintId);
    const folderId = isId(list.folderId) ? String(list.folderId) : '';
    const sprintArray = { id: String(list._id), name: list.name || '', value: list.value };
    if (folderId) Object.assign(sprintArray, { folderId, folderName: await folderNameOf(companyId, folderId) });

    const [canAssign, canDate] = await Promise.all([
        writable(companyId, uid, 'task.task_assignee', targetId),
        writable(companyId, uid, 'task.task_due_date', targetId),
    ]);
    const owners = canAssign ? await ownersAllowed(companyId, source, wanted.map((w) => w.ownerId), targetId) : new Set();
    const backlink = `<p>${escapeHtml(source.kind === 'call' ? 'From meeting notes' : 'From doc')}: <a href="${escapeHtml(source.link)}">${escapeHtml(source.title || source.linkLabel)}</a></p>`;
    const projectData = {
        _id: String(project._id), CompanyId: String(companyId), lastTaskId: project.lastTaskId || 0,
        ProjectName: project.ProjectName || '', ProjectCode: project.ProjectCode || '',
    };
    const taskMongo = takeTaskMongo();
    const created = [];
    const failed = [];

    for (const item of wanted) {
        const ownerId = owners.has(item.ownerId) ? item.ownerId : '';
        const dueAt = canDate && item.due ? `${item.due}T12:00:00.000Z` : '';
        const data = {
            TaskName: item.title,
            TaskKey: '--',
            AssigneeUserId: ownerId ? [ownerId] : [],
            watchers: [String(uid)],
            DueDate: dueAt,
            dueDateDeadLine: dueAt ? [{ date: dueAt }] : [],
            TaskType: taskType.value,
            TaskTypeKey: taskType.key,
            ParentTaskId: '',
            ProjectID: String(project._id),
            CompanyId: String(companyId),
            status: { text: status.name, key: status.key, value: status.value, type: status.type },
            isParentTask: true,
            Task_Leader: String(uid),
            sprintArray,
            Task_Priority: 'MEDIUM',
            deletedStatusKey: 0,
            sprintId: String(list._id),
            statusType: status.type,
            statusKey: status.key,
            description: backlink,
            ...(folderId ? { folderObjId: folderId } : {}),
        };
        const body = { data, projectData, indexObj: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: status.key } };
        try {
            const { payload } = await prepareTaskRequest(Object.assign(Object.create(req), { body }), TASK_ACTION_FIELDS.create, 'create');
            const result = await taskMongo.create(payload);
            if (!result || !result.status || !result.id) {
                failed.push({ key: item.key, reason: result && result.isUpgrade ? 'plan_limit' : 'not_created' });
                continue;
            }
            created.push({
                key: item.key, taskId: String(result.id), title: item.title, ownerId, ownerName: '', due: dueAt ? item.due : '',
                projectId: String(project._id), sprintId: String(list._id), folderId,
            });
        } catch (error) {
            logger.error(`notesToTasks create: ${error.message}`);
            failed.push({ key: item.key, reason: error instanceof TaskWriteRefusal ? error.message : 'not_created' });
        }
    }

    await recordOnSource(companyId, source, created);
    return { created, failed };
}

async function undoTasks(req, { companyId, uid, kind, id, taskIds }) {
    const source = await loadSource(companyId, uid, kind, id);
    const linked = new Set(source.kind === 'page'
        ? (source.doc.linkedTasks || []).map(String)
        : storedItems(source).map((item) => String((item && item.taskId) || '')).filter(Boolean));
    const asked = [...new Set((Array.isArray(taskIds) ? taskIds : []).map(String))].filter((taskId) => isId(taskId) && linked.has(taskId));
    const tasks = asked.length ? await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: asked.map(oid) }, deletedStatusKey: 0 }],
    }, 'find') : [];
    const now = Date.now();
    const own = (tasks || []).filter((task) => String(task.Task_Leader) === String(uid)
        && !(task.createdAt && now - new Date(task.createdAt).getTime() > UNDO_WINDOW_MS));

    const actor = own.length ? await sessionActor(req) : null;
    const taskMongo = own.length ? takeTaskMongo() : null;
    const removed = [];
    for (const task of own) {
        try {
            const project = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(task.ProjectID) }] }, 'findOne');
            await taskMongo.updateArchiveDelete({ companyId, projectData: project, sprintId: task.sprintId, task, userData: actor, deletedStatusKey: 1 });
            removed.push(String(task._id));
        } catch (error) {
            logger.error(`notesToTasks undo ${task._id}: ${error.message}`);
        }
    }
    if (!removed.length) return { removed };

    const gone = new Set(removed);
    if (source.kind === 'page') {
        const page = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{ _id: source.doc._id }, { $set: { linkedTasks: (source.doc.linkedTasks || []).filter((t) => !gone.has(String(t))) } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (page) emitPageChange(companyId, 'update', page);
    } else {
        await saveCallItems(companyId, source, storedItems(source).map((item) => (item && gone.has(String(item.taskId))
            ? { ...item, taskId: '', projectId: '', sprintId: '' }
            : item)));
    }
    return { removed };
}

function answerError(res, error, label) {
    if (error instanceof Refusal) {
        return res.status(error.statusCode).send({ status: false, statusText: error.message, ...error.extra });
    }
    if (error instanceof TenantError || error instanceof TaskWriteRefusal) {
        return res.status(error.statusCode).send({ status: false, statusText: error.message });
    }
    if (aiSwitch.isAiOff(error)) return res.status(403).send({ status: false, statusText: error.message, code: error.code });
    logger.error(`notesToTasks ${label}: ${error && error.message ? error.message : error}`);
    return res.send({ status: false, statusText: (error && error.code && error.message) || 'Something went wrong.' });
}

const requestOf = (req) => ({ ...(req.body || {}), companyId: tenantOf(req), uid: String(req.uid || '') });

/* POST /api/v1/ai/notes-to-tasks/propose  { kind: 'call'|'page', id, projectId?, refresh? } */
async function proposeHandler(req, res) {
    try {
        const input = requestOf(req);
        const data = await propose({ ...input, kind: String(input.kind || ''), id: String(input.id || ''), refresh: input.refresh === true });
        return res.send({ status: true, data });
    } catch (error) {
        return answerError(res, error, 'propose');
    }
}

/* POST /api/v1/ai/notes-to-tasks  { kind, id, projectId?, sprintId?, items: [{ key, title, ownerId?, due? }] } */
async function createHandler(req, res) {
    try {
        const input = requestOf(req);
        const data = await createTasks(req, { ...input, kind: String(input.kind || ''), id: String(input.id || '') });
        return res.send({ status: data.created.length > 0, statusText: data.created.length ? '' : 'No task could be created.', data });
    } catch (error) {
        return answerError(res, error, 'create');
    }
}

/* POST /api/v1/ai/notes-to-tasks/undo  { kind, id, taskIds } */
async function undoHandler(req, res) {
    try {
        const input = requestOf(req);
        const data = await undoTasks(req, { ...input, kind: String(input.kind || ''), id: String(input.id || '') });
        return res.send({ status: true, data });
    } catch (error) {
        return answerError(res, error, 'undo');
    }
}

module.exports = { proposeHandler, createHandler, undoHandler, parseDue, matchOwner, parseItems };
