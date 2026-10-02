const { DateTime } = require('luxon');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const tools = require('../Automations/engine/tools');
const permissions = require('./permissions');
const setup = require('./setupRequests');
const { storedProject, whoOf, zoneOf } = require('./taskRequests');

// A folder with what goes in it, and a list made a sprint. Nothing is made until a person approves. Then each part
// is made by the route the web app calls for it, as the person who approved, and only where the person behind the
// agent may make that part by hand too. Taking a folder back puts the moved lists back and removes what the plan
// made while nobody has put anything in it since; taking a sprint back restores the list's former type and dates.

const FOLDER = 'folder.create';
const SPRINT = 'list.sprint.set';
const FOLDER_KIND = 'folder';
const SPRINT_KIND = 'listSprint';
const NAME_MAX = 50;
const SUBFOLDERS_MAX = 5;
const LISTS_MAX = 10;
const MOVES_MAX = 20;
const TRASHED = 1;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const LIST_NOT_FOUND = 'that list was not found in that project';
const LIST_CREATE = 'project.project_sprint_create';
const KEYS = Object.freeze({
    folders: ['project.project_folder_create'],
    lists: [LIST_CREATE],
    moves: [['project.project_sprint_name_edit', 'project.sprint_type_change', LIST_CREATE]],
});
const PARTS = Object.freeze(['folders', 'lists', 'moves']);
const ASKED = Object.freeze({ lists: 'lists', moves: 'moveListIds' });

const work = () => require('./workRequests');
const refuse = (message) => new tools.DeterministicError(message);
const idOf = (value) => (value === undefined || value === null ? '' : String(value));
const isId = (value) => OBJECT_ID.test(idOf(value));
const lower = (value) => String(value).trim().toLowerCase();
const listOf = (value) => (Array.isArray(value) ? value : []);
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const isoOf = (value) => (value ? new Date(value).toISOString() : null);
const twice = (names) => names.find((name, at) => names.findIndex((other) => lower(other) === lower(name)) !== at);

const folderOf = (given) => {
    const folder = objectOf(given);
    const lists = listOf(folder.lists).map((name) => setup.lineOf(name, work().LIST_NAME_MAX));
    const moveListIds = listOf(folder.moveListIds).map((id) => idOf(id).toLowerCase());
    return { name: setup.lineOf(folder.name, NAME_MAX), ...(lists.length ? { lists } : {}), ...(moveListIds.length ? { moveListIds } : {}) };
};

/* What a caller names, kept as plain text: the folder, the folder it goes in, and its subfolders, each with the lists to make in it and the lists to move into it. */
const draftOf = (given) => {
    const asked = objectOf(given);
    const subfolders = listOf(asked.subfolders).map(folderOf);
    return {
        ...folderOf(asked),
        ...(asked.parentFolderId === undefined ? {} : { parentFolderId: idOf(asked.parentFolderId).toLowerCase() }),
        ...(subfolders.length ? { subfolders } : {}),
    };
};

const foldersIn = (draft) => [draft, ...listOf(draft.subfolders)];
const partsOf = (draft) => PARTS.filter((part) => part === 'folders' || foldersIn(draft).some((folder) => listOf(folder[ASKED[part]]).length));

const folderProblem = (folder, where) => {
    if (!folder.name) return `${where} needs a name`;
    const lists = listOf(folder.lists);
    if (lists.length > LISTS_MAX || lists.some((name) => !name)) return `${where} takes at most ${LISTS_MAX} new lists, each with a name`;
    if (twice(lists)) return `"${twice(lists)}" is named twice in ${where}`;
    const moved = listOf(folder.moveListIds);
    return moved.length > MOVES_MAX || !moved.every(isId) ? `${where} takes at most ${MOVES_MAX} lists to move, each by its id` : '';
};

/* '' for a folder that can be asked for; otherwise what is wrong with the request. */
const folderPlanProblem = (given) => {
    const draft = draftOf(given);
    const subfolders = listOf(draft.subfolders);
    if (draft.parentFolderId !== undefined && !isId(draft.parentFolderId)) return 'parentFolderId needs a folder id';
    if (draft.parentFolderId && subfolders.length) return 'folders nest one level, so a subfolder takes no subfolders: name parentFolderId or subfolders, not both';
    if (subfolders.length > SUBFOLDERS_MAX) return `subfolders takes at most ${SUBFOLDERS_MAX} folders`;
    const wrong = foldersIn(draft).map((folder, at) => folderProblem(folder, at ? `subfolders[${at - 1}]` : 'the folder')).find(Boolean);
    if (wrong) return wrong;
    if (twice(subfolders.map((folder) => folder.name))) return `"${twice(subfolders.map((folder) => folder.name))}" is named twice in subfolders`;
    const moved = foldersIn(draft).flatMap((folder) => listOf(folder.moveListIds));
    return moved.length > new Set(moved).size ? 'a list is moved into one folder only' : '';
};

const lacked = async (companyId, uid, projectId, part) => {
    const access = await require('../../Config/projectAccess').canEditProject(companyId, idOf(uid), projectId, KEYS[part]);
    return access.allowed ? '' : `${access.permission || KEYS[part].flat()[0]} is not granted`;
};

/* The parts of a folder plan `uid` may not make by hand in the project, each with the reason. */
const refusedParts = async (companyId, uid, projectId, draft) => {
    const refused = [];
    for (const part of partsOf(draft)) {
        const reason = await lacked(companyId, uid, projectId, part);
        if (reason) refused.push({ part, reason });
    }
    return refused;
};

const barredParts = async ({ companyId, projectId, requester, approver, draft }) => {
    const [own, theirs] = [await refusedParts(companyId, requester.uid, projectId, draft), await refusedParts(companyId, approver.uid, projectId, draft)];
    return Object.fromEntries(partsOf(draft).map((part) => {
        const byApprover = theirs.find((entry) => entry.part === part);
        const byRequester = own.find((entry) => entry.part === part);
        return [part, (byApprover && `the approver may not make this part: ${byApprover.reason}`) || (byRequester && `${permissions.REASON}: ${byRequester.reason}`) || ''];
    }));
};

const approverOf = (requester, approverId) => ({ uid: approverId, via: requester.via, mark: requester.mark ? { ...requester.mark, userId: approverId } : null });

/* The list of that project, when `uid` may open it. */
const listFor = (companyId, uid, projectId, sprintId) => require('../Tasks/helpers/taskWritePlacement').listOf(companyId, idOf(uid), projectId, idOf(sprintId));

/* The top-level folder of that project a subfolder can go in, or why it cannot. */
const parentProblem = (companyId, projectId, parentFolderId) => require('../Sprints/helpers/folderTree')
    .parentForNewFolder(companyId, projectId, parentFolderId).then(() => '', (error) => error.message);

const makeFolder = async ({ companyId, who, projectId, name, parentFolderId }) => {
    const answer = await setup.answerOf('folderCreate', { companyId, who, body: { projectId, folderName: name, ...(parentFolderId ? { parentFolderId } : {}) } });
    const saved = answer.code === 200 && answer.body && answer.body.status === true && answer.body.data;
    if (!saved || !saved._id) throw refuse(setup.reasonOf(answer, 'the folder was not created'));
    return { folderId: idOf(saved._id), name: saved.name || name };
};

const attempt = async (item, barred, run) => {
    if (barred) return { ...item, made: false, error: barred };
    try {
        return { ...item, ...(await run()), made: true };
    } catch (error) {
        return { ...item, made: false, error: error.message };
    }
};

/* The lists of one folder: made in it, or moved into it. A list is moved only when the person behind the agent and the approver can both open it. */
const fill = async ({ companyId, requester, approver, projectId, folder, into, barred }, out) => {
    for (const name of listOf(folder.lists)) {
        out.lists.push(await attempt({ name, folder: into.name }, barred.lists, async () => {
            const made = await work().createList({ companyId, who: approver, projectId, name, folderId: into.folderId });
            return { name: made.name, sprintId: made.sprintId };
        }));
    }
    for (const sprintId of listOf(folder.moveListIds)) {
        out.moves.push(await attempt({ sprintId, folder: into.name }, barred.moves, async () => {
            if (!(await listFor(companyId, requester.uid, projectId, sprintId))) throw refuse(LIST_NOT_FOUND);
            const moved = await work().moveList({ companyId, who: approver, projectId, sprintId, folderId: into.folderId });
            return { name: moved.list.name || '', folderId: into.folderId, previous: moved.previous };
        }));
    }
};

const carryOut = async (context, draft) => {
    const { companyId, approver, projectId, barred } = context;
    const top = await makeFolder({ companyId, who: approver, projectId, name: draft.name, parentFolderId: draft.parentFolderId });
    const out = { top, folders: [{ name: top.name, made: true, folderId: top.folderId }], lists: [], moves: [] };
    await fill({ ...context, folder: draft, into: top }, out);
    for (const subfolder of listOf(draft.subfolders)) {
        const made = await attempt({ name: subfolder.name, folder: top.name }, '', () => makeFolder({ companyId, who: approver, projectId, name: subfolder.name, parentFolderId: top.folderId }));
        out.folders.push(made);
        const unmade = made.made ? barred : { lists: `the folder "${subfolder.name}" was not made`, moves: `the folder "${subfolder.name}" was not made` };
        await fill({ ...context, folder: subfolder, into: made, barred: unmade }, out);
    }
    return out;
};

const storedRow = (companyId, type, id) => (isId(id) ? MongoDbCrudOpration(companyId, { type, data: [{ _id: tools.oid(id) }] }, 'findOne') : null);
const isGone = (row) => !row || Number(row.deletedStatusKey) === TRASHED;
const liveIn = (companyId, type, filter) => MongoDbCrudOpration(companyId, { type, data: [{ ...filter, deletedStatusKey: { $ne: TRASHED } }, { _id: 1 }] }, 'findOne');

const whyFolderStays = async (companyId, projectId, folderId) => {
    const inProject = { projectId: tools.oid(projectId) };
    if (await liveIn(companyId, SCHEMA_TYPE.SPRINTS, { ...inProject, folderId: tools.oid(folderId) })) return 'it holds a list now';
    return await liveIn(companyId, SCHEMA_TYPE.FOLDERS, { ...inProject, parentFolderId: tools.oid(folderId) }) ? 'it holds a folder now' : '';
};

const trashFolder = async ({ companyId, who, project, folder }) => {
    const projectId = idOf(project._id);
    const answer = await setup.answerOf('folderUpdate', {
        companyId, who, params: { id: folder.folderId },
        body: { type: 'updateFolder', projectId, folderName: folder.name, projectData: { id: projectId, ProjectName: project.ProjectName || '' }, updateObject: { $set: { deletedStatusKey: TRASHED } } },
    });
    if (answer.code === 200 && answer.body && answer.body.status === true) return '';
    return answer.code === 403 ? 'you may not delete a folder in this project' : setup.reasonOf(answer, 'the folder was not removed');
};

const moveBack = async ({ companyId, who, projectId, move }, out) => {
    const row = await storedRow(companyId, SCHEMA_TYPE.SPRINTS, move.sprintId);
    if (isGone(row) || idOf(row.folderId) !== idOf(move.folderId)) return;
    const list = await listFor(companyId, who.uid, projectId, move.sprintId);
    try {
        if (!list) throw refuse('a list you cannot open stays where it is');
        await work().moveList({ companyId, who, projectId, sprintId: move.sprintId, folderId: move.previous });
        out.movedBack.push(list.name || '');
    } catch (error) {
        out.kept.push(`${list ? `the list "${list.name || ''}"` : 'a list'} was not moved back: ${error.message}`);
    }
};

/* Taking a folder back, as the person undoing: moved lists go back, the lists and folders the plan made go to the
 * trash, and anything that holds what a person added since stays. What stays is said by refusing the undo once the
 * rest is done, so the person is told and can undo again; a part already taken back is passed over. */
const withdrawFolder = async ({ companyId, who, made }) => {
    const project = await storedProject(companyId, made.projectId);
    const projectId = idOf(project._id);
    const out = { movedBack: [], removed: { lists: [], folders: [] }, kept: [] };
    for (const move of [...listOf(made.moves)].reverse()) await moveBack({ companyId, who, projectId, move }, out);
    for (const list of [...listOf(made.lists)].reverse()) {
        if (isGone(await storedRow(companyId, SCHEMA_TYPE.SPRINTS, list.sprintId))) continue;
        await work().withdrawList({ companyId, who, projectId, sprintId: list.sprintId })
            .then(() => out.removed.lists.push(list.name), (error) => out.kept.push(`the list "${list.name}" stays: ${error.message}`));
    }
    for (const folder of [...listOf(made.folders)].reverse()) {
        if (isGone(await storedRow(companyId, SCHEMA_TYPE.FOLDERS, folder.folderId))) continue;
        const reason = await whyFolderStays(companyId, projectId, folder.folderId) || await trashFolder({ companyId, who, project, folder });
        if (reason) out.kept.push(`the folder "${folder.name}" stays: ${reason}`);
        else out.removed.folders.push(folder.name);
    }
    if (out.kept.length) throw refuse(out.kept.join('; '));
    return { projectId, movedBack: out.movedBack, removed: out.removed };
};

const isDay = (value) => typeof value === 'string' && ISO_DAY.test(value) && DateTime.fromISO(value).isValid;

/* '' for dates a sprint can take; otherwise what is wrong with them. */
const sprintProblem = (given) => {
    const asked = objectOf(given);
    if (!isDay(asked.startDate) || !isDay(asked.endDate)) return 'startDate and endDate each need a day as YYYY-MM-DD';
    return asked.startDate <= asked.endDate ? '' : 'startDate is after endDate';
};

/* The first moment of the first day to the last moment of the last, where the person who asked is. */
const boxOf = (params, zone) => ({
    startDate: DateTime.fromISO(params.startDate, { zone }).startOf('day').toJSDate().toISOString(),
    endDate: DateTime.fromISO(params.endDate, { zone }).endOf('day').toJSDate().toISOString(),
});

const setScrum = async ({ companyId, who, body }, forbidden) => {
    const answer = await setup.answerOf('sprintScrum', { companyId, who, body });
    if (answer.code === 200 && answer.body && answer.body.status === true) return answer.body.data || {};
    if (answer.code === 404) throw refuse(LIST_NOT_FOUND);
    throw refuse(answer.code === 403 ? `${forbidden}: ${(answer.body && answer.body.permission) || LIST_CREATE} is not granted` : setup.reasonOf(answer, 'the list was not changed'));
};

const sameMoment = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

/* The list goes back to what it was, through the same route, and only while its dates are still the ones that were set. */
const withdrawSprint = async ({ companyId, who, made }) => {
    const list = await listFor(companyId, who.uid, made.projectId, made.sprintId);
    if (!list) throw refuse(LIST_NOT_FOUND);
    const name = list.name || '';
    if (list.isScrum !== true || !sameMoment(list.startDate, made.set.startDate) || !sameMoment(list.endDate, made.set.endDate)) {
        throw refuse(`"${name}" was changed since, so it stays as it is now`);
    }
    const { isScrum, startDate, endDate } = made.previous;
    await setScrum({ companyId, who, body: isScrum ? { sprintId: made.sprintId, isScrum: true, startDate, endDate } : { sprintId: made.sprintId, isScrum: false } }, `you may not change "${name}"`);
    return { projectId: made.projectId, sprintId: made.sprintId, name, sprint: isScrum };
};

const executors = {
    async [FOLDER]({ companyId, actor, params, depth, approvedBy }) {
        const approverId = idOf(approvedBy);
        if (!approverId) throw refuse('a folder is made only once a person has approved it');
        const problem = folderPlanProblem(params);
        if (problem) throw refuse(problem);
        const project = await storedProject(companyId, params.projectId);
        const projectId = idOf(project._id);
        const draft = draftOf(params);
        const requester = whoOf(actor, depth);
        const approver = approverOf(requester, approverId);
        const barred = await barredParts({ companyId, projectId, requester, approver, draft });
        if (barred.folders) throw refuse(barred.folders);
        const out = await carryOut({ companyId, requester, approver, projectId, barred }, draft);
        const parts = partsOf(draft).map((part) => ({ part, ok: out[part].every((item) => item.made), items: out[part] }));
        const made = (part) => out[part].filter((item) => item.made);
        return {
            result: {
                projectId, folderId: out.top.folderId, name: out.top.name, made: PARTS.reduce((count, part) => count + made(part).length, 0), parts,
                notMade: parts.flatMap((entry) => entry.items.filter((item) => item.error).map((item) => ({ part: entry.part, name: item.name || '', error: item.error }))),
            },
            undo: {
                kind: FOLDER_KIND, projectId,
                folders: made('folders').map((item) => ({ folderId: item.folderId, name: item.name })),
                lists: made('lists').map((item) => ({ sprintId: item.sprintId, name: item.name })),
                moves: made('moves').map((item) => ({ sprintId: item.sprintId, folderId: item.folderId, previous: item.previous })),
            },
            entityType: 'project', entityId: projectId, entityName: project.ProjectName || '',
        };
    },

    async [SPRINT]({ companyId, actor, params, depth, approvedBy }) {
        const approverId = idOf(approvedBy);
        if (!approverId) throw refuse('a list is made a sprint only once a person has approved it');
        const problem = sprintProblem(params);
        if (problem) throw refuse(problem);
        const projectId = idOf((await storedProject(companyId, params.projectId))._id);
        const requester = whoOf(actor, depth);
        const list = await listFor(companyId, requester.uid, projectId, params.sprintId);
        if (!list || !(await listFor(companyId, approverId, projectId, params.sprintId))) throw refuse(LIST_NOT_FOUND);
        const own = await lacked(companyId, requester.uid, projectId, 'lists');
        if (own) throw refuse(`${permissions.REASON}: ${own}`);
        const sprintId = idOf(list._id);
        const set = boxOf(params, await zoneOf(requester.uid));
        await setScrum({ companyId, who: approverOf(requester, approverId), body: { sprintId, isScrum: true, ...set } }, 'the approver may not make this list a sprint');
        const previous = { isScrum: list.isScrum === true, startDate: isoOf(list.startDate), endDate: isoOf(list.endDate) };
        return {
            result: { projectId, sprintId, name: list.name || '', sprint: true, startDate: params.startDate, endDate: params.endDate, wasSprint: previous.isScrum },
            undo: { kind: SPRINT_KIND, projectId, sprintId, set, previous },
            entityType: 'sprint', entityId: sprintId, entityName: list.name || '',
        };
    },
};

const inverses = {
    [FOLDER_KIND]: (companyId, made, actor) => withdrawFolder({ companyId, who: whoOf(actor), made }),
    [SPRINT_KIND]: (companyId, made, actor) => withdrawSprint({ companyId, who: whoOf(actor), made }),
};

module.exports = {
    executors, inverses, draftOf, folderPlanProblem, refusedParts, parentProblem, listFor, sprintProblem,
    FOLDER, SPRINT, FOLDER_KIND, SPRINT_KIND, NAME_MAX, SUBFOLDERS_MAX, LISTS_MAX, MOVES_MAX, LIST_NOT_FOUND,
};
