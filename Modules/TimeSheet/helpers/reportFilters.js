const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const mongoose = require('mongoose');
const { idForms, HEX_ID } = require('../../../utils/mongo-handler/objectIdKeys');

const MAX_VALUES = 200;
const MAX_TEXT = 120;
const BILLABLE = ['billable', 'non_billable'];

const textList = (value) => [...new Set((Array.isArray(value) ? value : [])
    .filter((item) => typeof item === 'string' || typeof item === 'number')
    .map((item) => String(item).trim())
    .filter((item) => item && item.length <= MAX_TEXT))].slice(0, MAX_VALUES);

/* The report filters a time screen sends (the Time tabs' filter bar): lists, task status names, tags and billable.
 * A query string carries them as JSON. Anything else is dropped, so a filter can only be one of these. */
const normalizeReportFilters = (raw) => {
    let input = raw;
    if (typeof input === 'string') {
        try { input = JSON.parse(input); } catch (e) { input = {}; }
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
    return {
        lists: textList(input.lists).filter((id) => HEX_ID.test(id)),
        status: textList(input.status),
        tags: textList(input.tags),
        billable: BILLABLE.includes(input.billable) ? input.billable : '',
    };
};

const needsTasks = (filters) => Boolean(filters.lists.length || filters.status.length || filters.tags.length);

/* The tasks match for the task-side filters, inside the projects the caller's scope reads. */
const taskMatchOf = (filters, scope = {}) => {
    const clauses = [];
    if (filters.lists.length) {
        const lists = idForms(filters.lists);
        clauses.push({ $or: [{ sprintId: { $in: lists } }, { extraLists: { $elemMatch: { sprintId: { $in: lists } } } }] });
    }
    if (filters.status.length) clauses.push({ 'status.text': { $in: filters.status } });
    if (filters.tags.length) clauses.push({ tagsArray: { $in: filters.tags } });
    const match = { $and: clauses };
    if (Array.isArray(scope.visible)) match.ProjectID = { $in: idForms(scope.visible) };
    else if (Array.isArray(scope.hidden) && scope.hidden.length) match.ProjectID = { $nin: idForms(scope.hidden) };
    return match;
};

const objectIds = (ids) => ids.filter((id) => HEX_ID.test(id)).map((id) => new mongoose.Types.ObjectId(id));

/* null when no task-side filter is set; otherwise the ids of the session company's tasks that pass them (maybe none).
 * `candidates` are the tasks the report's rows name: the lookup then reads only those, not every task of the company. */
const reportTaskIds = async (companyId, scope, filters, candidates = null) => {
    if (!needsTasks(filters)) return null;
    if (candidates && !candidates.length) return [];
    const match = taskMatchOf(filters, scope);
    if (candidates) match._id = { $in: objectIds(candidates) };
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [match, { _id: 1 }],
    }, 'find') || [];
    return rows.map((row) => String(row._id));
};

/* The distinct task ids of the rows a match reads, as text. */
const taskIdsIn = async (companyId, type, match, field) => {
    const rows = await MongoDbCrudOpration(companyId, { type, data: [[{ $match: match }, { $group: { _id: `$${field}` } }]] }, 'aggregate') || [];
    return [...new Set(rows.map((row) => String(row._id || '')).filter(Boolean))];
};

const billableClause = (billable) => {
    if (billable === 'non_billable') return { billable: false };
    if (billable === 'billable') return { billable: { $ne: false } };
    return null;
};

/* Clauses only ever go under $and next to the scope's own match, so a filter narrows what the scope returns and
 * never replaces one of its fields. */
const narrowMatch = (match, clauses) => (clauses.length ? { ...match, $and: [...(match.$and || []), ...clauses] } : match);

/* For a time-log (timesheet collection) match. With `baseMatch` (the rows the report reads before these filters), only
 * the tasks those rows name are looked up. `extraCandidates` adds tasks another collection names (a workload's plans). */
const reportTimeClauses = async (companyId, scope, filters, { baseMatch = null, extraCandidates = [] } = {}) => {
    const clauses = [];
    let candidates = null;
    if (baseMatch && needsTasks(filters)) {
        candidates = [...new Set([...await taskIdsIn(companyId, SCHEMA_TYPE.TIMESHEET, baseMatch, 'TicketID'), ...extraCandidates])];
    }
    const taskIds = await reportTaskIds(companyId, scope, filters, candidates);
    if (taskIds) clauses.push({ TicketID: { $in: idForms(taskIds) } });
    const billable = billableClause(filters.billable);
    if (billable) clauses.push(billable);
    return { clauses, taskIds };
};

/* For a plan (estimates collection) match: plans have no billable flag, so only the task-side filters apply. */
const estimateClausesOf = (taskIds) => (taskIds ? [{ TaskId: { $in: idForms(taskIds) } }] : []);

module.exports = { normalizeReportFilters, needsTasks, taskMatchOf, reportTaskIds, taskIdsIn, billableClause, narrowMatch, reportTimeClauses, estimateClausesOf };
