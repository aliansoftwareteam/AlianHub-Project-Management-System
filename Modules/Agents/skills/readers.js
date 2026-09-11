// The gather readers behind READER_CATALOGUE. Every function takes companyId
// first and goes through MongoDbCrudOpration; a data skill never sees a
// database handle, only the value a reader returns.

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { DONE_STATUS_TYPES } = require('../registry');
const memoryStore = require('../memory');
const { READER_CATALOGUE, plain } = require('./catalogues');

const DAY_MS = 24 * 60 * 60 * 1000;
const BLOCKED = /hold|block|wait/i;

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const isDone = (t) => DONE_STATUS_TYPES.includes(String(t.statusType || (t.status && t.status.type) || '').toLowerCase());
const dueMs = (t) => (t.DueDate ? Date.parse(t.DueDate) : NaN);
const row = (t) => `${t.TaskKey || '—'} ${String(t.TaskName || '').slice(0, 70)}${t.status && t.status.text ? ` [${t.status.text}]` : ''}${t.DueDate ? ` due ${String(t.DueDate).slice(0, 10)}` : ''}${Array.isArray(t.AssigneeUserId) && t.AssigneeUserId.length ? '' : ' [unassigned]'}`;

/* Params are filled from the catalogue defaults and clamped to its bounds, so
 * a stored skill cannot ask a reader for more than the catalogue allows. */
const paramsFor = (reader, given = {}) => {
    const spec = READER_CATALOGUE[reader].params;
    const out = {};
    Object.entries(spec).forEach(([name, rule]) => {
        const raw = given[name];
        if (rule.type === 'number') {
            const n = Number(raw);
            out[name] = Number.isFinite(n) ? Math.min(rule.max, Math.max(rule.min, Math.round(n))) : rule.default;
        } else if (rule.type === 'boolean') {
            out[name] = typeof raw === 'boolean' ? raw : rule.default;
        }
    });
    return out;
};

const READERS = Object.freeze({
    async task(companyId, { task }, params) {
        const brief = plain(task.description || task.rawDescription || '');
        return { key: task.TaskKey || '', title: task.TaskName || '', brief: brief.slice(0, params.maxChars), chars: brief.length };
    },

    async project(companyId, { task }, params) {
        const projectId = oid(task.ProjectID);
        if (!projectId) return { skip: 'the task has no project' };
        const project = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [{ _id: projectId, deletedStatusKey: { $ne: 1 } }, { ProjectName: 1, aiGuide: 1 }],
        }, 'findOne');
        if (!project) return { skip: 'the project was not found' };
        const guide = project.aiGuide && project.aiGuide.markdown ? String(project.aiGuide.markdown).slice(0, params.maxChars) : '';
        return { name: project.ProjectName || '', guide, hasGuide: Boolean(guide) };
    },

    async 'project.tasks'(companyId, { task }, params) {
        const projectId = String(task.ProjectID || '');
        if (!projectId) return { skip: 'the task has no project' };
        const tasks = (await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ ProjectID: projectId, deletedStatusKey: { $ne: 1 }, isParentTask: true },
                   { TaskKey: 1, TaskName: 1, status: 1, statusType: 1, DueDate: 1, AssigneeUserId: 1, updatedAt: 1 },
                   { limit: 400, sort: { DueDate: 1 } }],
        }, 'find')) || [];
        if (!tasks.length) return { skip: 'the project has no tasks yet' };
        const now = Date.now();
        const open = tasks.filter((t) => !isDone(t));
        const listed = (params.openOnly ? open : tasks).slice(0, params.limit);
        return {
            count: tasks.length,
            open: open.length,
            done: tasks.length - open.length,
            overdue: open.filter((t) => Number.isFinite(dueMs(t)) && dueMs(t) < now - DAY_MS).length,
            blocked: open.filter((t) => BLOCKED.test(String((t.status && t.status.text) || ''))).length,
            unassigned: open.filter((t) => !(Array.isArray(t.AssigneeUserId) && t.AssigneeUserId.length)).length,
            list: listed.map((t) => `- ${row(t)}`).join('\n'),
        };
    },

    async memory(companyId, { task, memory, startedBy }, params) {
        const text = typeof memory === 'string' ? memory : await memoryStore.contextFor({ companyId, projectId: String(task.ProjectID || ''), userId: startedBy, maxChars: params.maxChars });
        return { text: String(text || '').slice(0, params.maxChars) };
    },

    async linked_doc(companyId, { task }, params) {
        const taskId = oid(task._id);
        if (!taskId) return { skip: 'the task has no id' };
        const page = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{ linkedTasks: taskId, visibility: 'project', deletedStatusKey: { $ne: 1 } }, { title: 1, rawText: 1 }, { sort: { updatedAt: -1 } }],
        }, 'findOne');
        if (!page) return { skip: 'no document is attached to this task' };
        return { title: page.title || '', text: plain(page.rawText || '').slice(0, params.maxChars) };
    },
});

const read = (reader, companyId, scope, params) => {
    const fn = READERS[reader];
    if (!fn) throw Object.assign(new Error(`unknown reader "${reader}"`), { deterministic: true });
    return fn(companyId, scope, paramsFor(reader, params));
};

module.exports = { read, paramsFor, READERS };
