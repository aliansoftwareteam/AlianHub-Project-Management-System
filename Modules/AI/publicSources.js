'use strict';

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { escapeRegex } = require('../../utils/escapeRegex');
const { visibleProjects } = require('../Agents/scope');
const { commentThreadAccess } = require('../Comments/helpers/threadAccess');
const { searchTerms } = require('./ask');

/* A reply everyone in a thread reads may only draw on what every one of them can open. Past this many readers the
 * intersection is not worked out and the answer comes from the conversation alone. */
const READER_CAP = 50;
const MAX_TASKS = 12;
const MAX_PAGES = 6;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const isId = (value) => OBJECT_ID.test(String(value || ''));
const bothForms = (ids) => ids.flatMap((id) => (isId(id) ? [String(id), new mongoose.Types.ObjectId(String(id))] : [String(id)]));
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const statusText = (t) => ((t.status && typeof t.status === 'object') ? t.status.text : t.status) || t.statusType || '';

const textMatch = (terms, fields) => (terms.length
    ? { $or: fields.map((f) => ({ [f]: { $regex: terms.map(escapeRegex).join('|'), $options: 'i' } })) }
    : {});

/* A direct message is read by its participants; a channel by whoever the thread rule lets in, looked for among the
 * workspace's live seats. null when there are too many to check. */
const threadReaders = async (companyId, thread, conversation) => {
    let candidates;
    if (conversation && Array.isArray(conversation.AssigneeUserId)) {
        candidates = conversation.AssigneeUserId.map(String);
    } else {
        const seats = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS, data: [{ ...ACTIVE_SEAT }, { userId: 1 }, { limit: READER_CAP + 1 }],
        }, 'find');
        candidates = (seats || []).map((seat) => String(seat.userId));
    }
    candidates = [...new Set(candidates.filter(isId))];
    if (candidates.length > READER_CAP) return null;
    const decisions = await Promise.all(candidates.map((uid) => commentThreadAccess(companyId, uid, thread).catch(() => ({ allowed: false }))));
    return candidates.filter((uid, index) => decisions[index].allowed);
};

/* The projects every reader can open. */
const sharedProjects = async (companyId, readers) => {
    if (!readers || !readers.length) return [];
    const lists = await Promise.all(readers.map((uid) => visibleProjects(companyId, uid).catch(() => [])));
    const [first, ...rest] = lists;
    const sets = rest.map((list) => new Set(list.map((p) => String(p._id))));
    return (first || []).filter((p) => sets.every((set) => set.has(String(p._id))));
};

const privateSprintIds = async (companyId, projectIds) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS, data: [{ projectId: { $in: bothForms(projectIds) }, private: true }, { _id: 1 }],
    }, 'find');
    return (rows || []).map((row) => String(row._id));
};

/* Tasks outside private sprints and pages that are not private, in the given projects only. */
const publicSources = async (companyId, { question, projects }) => {
    const ids = (projects || []).map((p) => String(p._id)).filter(isId);
    if (!ids.length) return [];
    const nameById = Object.fromEntries(projects.map((p) => [String(p._id), p.ProjectName || '']));
    const terms = searchTerms(question);
    const hidden = await privateSprintIds(companyId, ids);
    const [tasks, pages] = await Promise.all([
        MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{
                deletedStatusKey: { $ne: 1 }, mainChat: { $ne: true }, ProjectID: { $in: bothForms(ids) },
                ...(hidden.length ? { sprintId: { $nin: bothForms(hidden) } } : {}),
                ...textMatch(terms, ['TaskName', 'TaskKey', 'rawDescription']),
            }, 'TaskName TaskKey status statusType Task_Priority ProjectID rawDescription updatedAt', { sort: { updatedAt: -1 }, limit: MAX_TASKS }],
        }, 'find'),
        MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PAGES,
            data: [{
                deletedStatusKey: { $ne: 1 }, visibility: { $ne: 'private' }, ProjectID: { $in: bothForms(ids) },
                ...textMatch(terms, ['title']),
            }, 'title ProjectID updatedAt', { sort: { updatedAt: -1 }, limit: MAX_PAGES }],
        }, 'find'),
    ]);
    return [
        ...(tasks || []).map((t) => ({
            kind: 'task',
            id: String(t._id),
            ref: t.TaskKey || String(t._id).slice(-6),
            title: clip(t.TaskName, 160),
            project: nameById[String(t.ProjectID)] || '',
            projectId: String(t.ProjectID || ''),
            detail: clip([statusText(t), t.Task_Priority, clip(t.rawDescription, 240)].filter(Boolean).join(' · '), 300),
        })),
        ...(pages || []).map((p) => ({
            kind: 'page',
            id: String(p._id),
            ref: `page:${String(p._id).slice(-6)}`,
            title: clip(p.title, 160),
            project: nameById[String(p.ProjectID)] || '',
            projectId: String(p.ProjectID || ''),
            detail: '',
        })),
    ];
};

/* The sources of `used` that sit where every reader of the thread can open them, as `kind:id`. Only a task outside a
 * private sprint and a page that is not private can be: every other kind is narrower than a project. */
const sharedAmong = async (companyId, { thread, conversation, used }) => {
    const keys = (Array.isArray(used) ? used : []).filter(([kind, id]) => ['task', 'page'].includes(kind) && isId(id));
    if (!keys.length) return new Set();
    const projects = await sharedProjects(companyId, await threadReaders(companyId, thread, conversation));
    const shared = new Set(projects.map((p) => String(p._id)));
    if (!shared.size) return new Set();
    const hidden = new Set(await privateSprintIds(companyId, [...shared]));
    const byKind = (kind) => keys.filter(([k]) => k === kind).map(([, id]) => new mongoose.Types.ObjectId(id));
    const [tasks, pages] = await Promise.all([
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: byKind('task') } }, 'ProjectID sprintId deletedStatusKey mainChat'] }, 'find'),
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PAGES, data: [{ _id: { $in: byKind('page') } }, 'ProjectID visibility deletedStatusKey'] }, 'find'),
    ]);
    const okTask = (t) => t.deletedStatusKey !== 1 && t.mainChat !== true && shared.has(String(t.ProjectID)) && !(t.sprintId && hidden.has(String(t.sprintId)));
    const okPage = (p) => p.deletedStatusKey !== 1 && p.visibility !== 'private' && shared.has(String(p.ProjectID));
    return new Set([
        ...(tasks || []).filter(okTask).map((row) => `task:${String(row._id)}`),
        ...(pages || []).filter(okPage).map((row) => `page:${String(row._id)}`),
    ]);
};

/* Whether every source an answer was built from sits where every reader of the thread can open it. */
const allShared = async (companyId, { thread, conversation, used }) => {
    const keys = Array.isArray(used) ? used : [];
    if (!keys.length) return true;
    const shared = await sharedAmong(companyId, { thread, conversation, used: keys });
    return keys.every(([kind, id]) => shared.has(`${kind}:${id}`));
};

module.exports = { READER_CAP, threadReaders, sharedProjects, publicSources, sharedAmong, allShared };
