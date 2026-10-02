const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { canReadProject } = require('../../../Config/projectAccess');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { canSeeSprintById } = require('../../Sprints/helpers/sprintVisibility');
const { sprintPlacementOf } = require('./sprintPlacement');
const { canReadTask } = require('./taskReadAccess');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TASK_ACCESS_FIELDS = Object.freeze({ ProjectID: 1, sprintId: 1, mainChat: 1, AssigneeUserId: 1 });

const idOf = (value) => (value === undefined || value === null ? '' : String(value));
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/* The project a write lands in, when `uid` can open it; null otherwise, whether it is hidden or missing. */
const openProject = async (companyId, uid, projectId) => {
    if (!OBJECT_ID.test(idOf(projectId)) || !(await canReadProject(companyId, uid, projectId)).allowed) return null;
    return MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(projectId) }] }, 'findOne');
};

/* Conversations are created through the task route into a chat space, which is a main_chats row and not a project. */
const isChatSpace = async (companyId, id) => OBJECT_ID.test(idOf(id))
    && Boolean(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.MAIN_CHATS, data: [{ _id: oid(id) }, { _id: 1 }] }, 'findOne'));

/* A conversation belongs to the people in it, so whoever starts one is among them. */
const startsOwnConversation = (uid, data) => isPlainObject(data) && Array.isArray(data.AssigneeUserId) && data.AssigneeUserId.map(idOf).includes(idOf(uid));

/* The list a write names, when it is a list of that project `uid` may see. */
const listOf = async (companyId, uid, projectId, sprintId) => {
    if (!OBJECT_ID.test(idOf(sprintId))) return null;
    const sprint = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: oid(sprintId), deletedStatusKey: { $nin: [1] } }] }, 'findOne');
    if (!sprint || idOf(sprint.projectId) !== idOf(projectId)) return null;
    if (!isPrivileged(await getRoleType(companyId, uid)) && !(await canSeeSprintById(companyId, uid, sprintId))) return null;
    return sprint;
};

/* A list as the task handlers store it on a task, read from the stored row. */
const listRef = async (companyId, sprint) => {
    const { sprintArray } = (await sprintPlacementOf(companyId, sprint)).set;
    return {
        id: idOf(sprintArray.id),
        name: sprintArray.name,
        ...(sprintArray.folderId ? { folderId: idOf(sprintArray.folderId), folderName: sprintArray.folderName || '' } : {}),
    };
};

/* The ids among `taskIds` whose task `uid` can read; a task that is hidden or missing is left out alike. */
const readableTaskIds = async (companyId, uid, taskIds) => {
    const ids = [...new Set((taskIds || []).map(idOf))].filter((id) => OBJECT_ID.test(id));
    if (!ids.length) return [];
    const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: ids.map(oid) } }, TASK_ACCESS_FIELDS] }, 'find') || [];
    const verdicts = new Map();
    const readable = (row) => {
        const place = `${idOf(row.ProjectID)}|${idOf(row.sprintId)}`;
        if (!verdicts.has(place)) {
            verdicts.set(place, canReadProject(companyId, uid, idOf(row.ProjectID)).then((project) => project.allowed === true && canReadTask(companyId, uid, row)));
        }
        return verdicts.get(place);
    };
    const kept = [];
    for (const row of rows) {
        if (row.mainChat !== true && await readable(row)) kept.push(idOf(row._id));
    }
    return kept;
};

const flatStatus = (row) => (row && row.convertStatus ? row.convertStatus : row);

/* The move handler reads each row's status and type out of the mapping after it has taken the row off
 * its list, so a row the mapping does not cover is refused before anything is written. */
const coveredByMapping = (rows, mapping) => rows.every((row) => {
    const status = mapping.taskStatusData.find((entry) => entry.key === row.statusKey);
    const type = mapping.taskTypeCounts.find((entry) => entry.value === row.TaskType);
    return Boolean(status && status.convertStatus && type && type.convertType);
});

/* The mapping a move into another project sends, as the move dialog builds it: each status and task type
 * of the project it leaves, with the one of `destination` it becomes. What it becomes is read from the
 * destination project, so the body only chooses among what that project has; null when it names another. */
const moveMappingInto = (sent, destination) => {
    const statuses = (Array.isArray(destination.taskStatusData) ? destination.taskStatusData : []).map(flatStatus).filter(Boolean);
    const types = (Array.isArray(destination.taskTypeCounts) ? destination.taskTypeCounts : []).filter(Boolean);
    const rowsOf = (list) => (Array.isArray(list) ? list.filter(isPlainObject) : []);
    const mapped = (rows, from, becomes, read) => rows.filter((row) => isPlainObject(row[becomes])).map((row) => ({ [from]: row[from], [becomes]: read(row[becomes]) }));

    const taskStatusData = mapped(rowsOf(sent && sent.taskStatusData), 'key', 'convertStatus', (wanted) => {
        const to = statuses.find((status) => idOf(status.key) === idOf(wanted.key));
        return to ? { key: to.key, name: to.name, type: to.type } : null;
    });
    const taskTypeCounts = mapped(rowsOf(sent && sent.taskTypeCounts), 'value', 'convertType', (wanted) => {
        const to = types.find((type) => idOf(type.value) === idOf(wanted.value));
        return to ? { value: to.value, key: to.key } : null;
    });
    const named = [...taskStatusData.map((row) => row.convertStatus), ...taskTypeCounts.map((row) => row.convertType)];
    return named.includes(null) ? null : { taskStatusData, taskTypeCounts };
};

/* The list a stored row sits in, as the handlers name the list a task leaves. */
const listLeftBy = (row) => ({
    id: idOf(row.sprintId),
    folderId: row.folderObjId ? idOf(row.folderObjId) : null,
    name: (row.sprintArray && row.sprintArray.name) || '',
    folderName: (row.sprintArray && row.sprintArray.folderName) || '',
});

const sameText = (a, b) => idOf(a).trim().toLowerCase() === idOf(b).trim().toLowerCase();
const distinct = (values) => values.filter((value, at) => value !== undefined && value !== null && values.indexOf(value) === at);

/* What each status and task type of `source`, and of the `rows` that leave it, becomes in `destination`, in the
 * shape the copy and conversion handlers read. Both sides come from the stored projects. `sent` chooses among
 * what the destination has; a status it leaves out keeps its name there or starts in the opening one, a task
 * type keeps its value or its name or becomes the first one. Null when the destination has no status or no type. */
const conversionRules = (source, destination, sent, rows = []) => {
    const from = source || {};
    const sameProject = Boolean(source) && idOf(source._id) === idOf(destination._id);
    const statuses = (Array.isArray(destination.taskStatusData) ? destination.taskStatusData : []).map(flatStatus).filter(Boolean);
    const types = (Array.isArray(destination.taskTypeCounts) ? destination.taskTypeCounts : []).filter(Boolean);
    const opening = statuses.find((status) => status.type === 'default_active') || statuses[0];
    if (!opening || !types.length) return null;

    const sourceStatuses = (Array.isArray(from.taskStatusData) ? from.taskStatusData : []).map(flatStatus).filter(Boolean);
    const sourceTypes = (Array.isArray(from.taskTypeCounts) ? from.taskTypeCounts : []).filter(Boolean);
    const chosen = (list, field, becomes) => (key) => {
        const row = (isPlainObject(sent) && Array.isArray(sent[list]) ? sent[list] : []).find((entry) => isPlainObject(entry) && entry[field] === key);
        return row && isPlainObject(row[becomes]) ? row[becomes] : null;
    };
    const chosenStatus = chosen('taskStatusData', 'key', 'convertStatus');
    const chosenType = chosen('taskTypeCounts', 'value', 'convertType');
    const statusFor = (key) => {
        const wanted = sameProject ? { key } : chosenStatus(key);
        const held = sourceStatuses.find((status) => status.key === key);
        return (wanted && statuses.find((status) => idOf(status.key) === idOf(wanted.key)))
            || (held && statuses.find((status) => sameText(status.name, held.name)))
            || opening;
    };
    const typeFor = (value) => {
        const wanted = sameProject ? { value } : chosenType(value);
        const held = sourceTypes.find((type) => type.value === value);
        return (wanted && types.find((type) => idOf(type.value) === idOf(wanted.value)))
            || types.find((type) => idOf(type.value) === idOf(value))
            || (held && types.find((type) => sameText(type.name, held.name)))
            || types[0];
    };
    return {
        id: source ? idOf(source._id) : '',
        ProjectName: from.ProjectName || '',
        taskStatusData: distinct([...sourceStatuses.map((status) => status.key), ...rows.map((row) => row.statusKey)]).map((key) => {
            const to = statusFor(key);
            return { key, convertStatus: { key: to.key, name: to.name, type: to.type } };
        }),
        taskTypeCounts: distinct([...sourceTypes.map((type) => type.value), ...rows.map((row) => row.TaskType)]).map((value) => {
            const to = typeFor(value);
            return { value, convertType: { value: to.value, key: to.key } };
        }),
    };
};

module.exports = {
    openProject,
    isChatSpace,
    startsOwnConversation,
    listOf,
    listRef,
    listLeftBy,
    readableTaskIds,
    flatStatus,
    coveredByMapping,
    moveMappingInto,
    conversionRules,
};
