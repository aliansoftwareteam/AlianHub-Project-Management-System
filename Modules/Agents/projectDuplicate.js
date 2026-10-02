const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const socketEmitter = require('../../event/socketEventEmitter');
const tools = require('../Automations/engine/tools');
const copyRules = require('../ProjectDuplicate/rules');
const setup = require('./setupRequests');
const projects = require('./projectCreate');
const { storedProject, whoOf } = require('./taskRequests');

// A copy of a project an agent asked for. Nothing is made until a person approves it. Then the copy is made by the
// route the web app duplicates a project with, as the person who approved, and from its first write it is private
// with only that person on it, whoever is on the project it is copied from. It holds what that person could copy by
// hand: the lists they can open and, when tasks were asked for, the tasks in them, without their assignees. The route
// copies the tasks of a large project after it has answered; such a project is not copied with its tasks here.
// Taking the copy back moves it to the trash, as the project's own Delete does, and never while it holds a doc, or a
// task that was not part of the copy.

const ACTION = 'project.duplicate';
const UNDO_KIND = 'projectCopy';
const TASKS_MAX = copyRules.INLINE_TASK_LIMIT;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const PERSONAL = 'a personal list cannot be copied';
const NOT_FOUND = 'the project to copy was not found';

const refuse = (message) => new tools.DeterministicError(message);
const idOf = (value) => (value === undefined || value === null ? '' : String(value));
const listOf = (value) => (Array.isArray(value) ? value : []);
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

/* What a caller names, kept as plain text: the project to copy, the name of the copy, and the tasks and the dates only when asked for. */
const draftOf = (given) => {
    const asked = objectOf(given);
    return {
        sourceProjectId: idOf(asked.sourceProjectId).toLowerCase(),
        name: setup.lineOf(asked.name, projects.NAME_MAX),
        ...(asked.tasks === true ? { tasks: true } : {}),
        ...(asked.dates === true ? { dates: true } : {}),
    };
};

/* '' for a copy that can be asked for; otherwise what is wrong with the request. */
const problemIn = (given) => {
    const draft = draftOf(given);
    if (!OBJECT_ID.test(draft.sourceProjectId)) return 'the project to copy needs its id';
    return draft.name.length < projects.NAME_MIN ? `name needs ${projects.NAME_MIN} to ${projects.NAME_MAX} characters` : '';
};

/* What stops `uid` from creating a project by hand, or ''. */
const refusedFor = async (companyId, uid) => {
    const own = await projects.mayCreate(companyId, uid);
    return own.allowed ? '' : `${own.permission} is not granted`;
};

/* The live project, when every one of `people` can open it. */
const sourceFor = async (companyId, people, sourceId) => {
    const { canReadProject } = require('../../Config/projectAccess');
    for (const uid of people) {
        if (!(await canReadProject(companyId, idOf(uid), sourceId)).allowed) return null;
    }
    return require('../ProjectDuplicate/build').liveProject(companyId, sourceId);
};

/* How many tasks the route would copy for `uid`: the live tasks of the lists that person's copy takes, read as the route reads them. Nothing is written. */
const taskCount = async ({ companyId, uid, source }) => {
    const { readSource } = require('../ProjectDuplicate/structure');
    const { planTasks } = require('../ProjectDuplicate/tasks');
    const bundle = await readSource({ companyId, caller: idOf(uid), source });
    const kept = new Map();
    copyRules.folderCopies(bundle.folders, source._id, kept);
    copyRules.listCopies(bundle.lists, source._id, kept, { dates: false });
    const lists = bundle.lists.filter((list) => kept.has(idOf(list._id)));
    return (await planTasks(companyId, idOf(source._id), lists.map((list) => list._id))).total;
};

const tooLarge = (count) => (count > TASKS_MAX
    ? `this project has ${count} tasks, and a copy an agent asks for takes at most ${TASKS_MAX}; ask for the copy without its tasks, or duplicate the project in AlianHub`
    : '');

const copyAs = async ({ companyId, who, draft }) => {
    const answer = await setup.answerOf('projectDuplicate', {
        companyId, who, params: { id: draft.sourceProjectId }, set: { onlyCaller: true },
        body: { name: draft.name, include: { tasks: draft.tasks === true, assignees: false, dates: draft.dates === true } },
    });
    const made = answer.code === 200 && answer.body && answer.body.status === true && answer.body.data;
    if (!made || !made.project || !made.project._id) throw refuse(setup.reasonOf(answer, 'the project was not copied'));
    return made;
};

const taskIdsIn = async (companyId, projectId) => listOf(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS, data: [{ ProjectID: { $in: idForms(projectId) } }, { _id: 1 }],
}, 'find')).map((task) => idOf(task._id));

const onlyOn = (project, uid) => project.isPrivateSpace === true && listOf(project.AssigneeUserId).map(String).join() === uid;

/* The route makes the copy private from its first write. Were it ever to answer with a copy someone else can open,
 * that copy goes to the trash and the change fails, so nothing an agent asked for is left open to others. */
const holdPrivate = async ({ companyId, approver, copy, taskIds }) => {
    if (onlyOn(copy, approver.uid)) return;
    const trashed = await projects.withdraw({ companyId, who: approver, projectId: idOf(copy._id), startedWith: taskIds }).then(() => true, () => false);
    throw refuse(`the copy "${copy.ProjectName || ''}" was not private to the approver, so ${trashed ? 'it was moved to the trash' : 'delete it in AlianHub: it could not be moved to the trash'}`);
};

const executors = {
    async [ACTION]({ companyId, actor, params, depth, approvedBy }) {
        const approverId = idOf(approvedBy);
        if (!approverId) throw refuse('a project is copied only once a person has approved it');
        const problem = problemIn(params);
        if (problem) throw refuse(problem);
        const draft = draftOf(params);
        const requester = whoOf(actor, depth);
        const lacked = await refusedFor(companyId, approverId);
        if (lacked) throw refuse(`the approver may not create a project: ${lacked}`);
        const source = await sourceFor(companyId, [requester.uid, approverId], draft.sourceProjectId);
        if (!source) throw refuse(NOT_FOUND);
        if (source.isPersonal === true) throw refuse(PERSONAL);
        const large = draft.tasks ? tooLarge(await taskCount({ companyId, uid: approverId, source })) : '';
        if (large) throw refuse(large);

        const approver = { uid: approverId, via: requester.via, mark: requester.mark ? { ...requester.mark, userId: approverId } : null };
        const made = await copyAs({ companyId, who: approver, draft });
        const copy = await storedProject(companyId, made.project._id);
        const projectId = idOf(copy._id);
        const taskIds = draft.tasks ? await taskIdsIn(companyId, projectId) : [];
        await holdPrivate({ companyId, approver, copy, taskIds });
        socketEmitter.emit('insert', { type: 'insert', companyId: String(companyId), data: copy, module: 'project' });

        // The counts are of what the approver could copy, so they are told only when the approver is the person who asked.
        const counted = approverId === requester.uid ? { copied: made.counts, notes: listOf(made.notes) } : {};
        const url = projects.addressOf(companyId, projectId);
        return {
            result: { projectId, name: copy.ProjectName || '', code: copy.ProjectCode || '', copiedFrom: draft.sourceProjectId, ...counted, ...(url ? { url } : {}) },
            undo: { kind: UNDO_KIND, projectId, taskIds },
            entityType: 'project', entityId: projectId, entityName: copy.ProjectName || '',
        };
    },
};

const inverses = {
    [UNDO_KIND]: (companyId, made, actor) => projects.withdraw({ companyId, who: whoOf(actor), projectId: made.projectId, startedWith: listOf(made.taskIds) }),
};

module.exports = { executors, inverses, draftOf, problemIn, refusedFor, sourceFor, taskCount, tooLarge, ACTION, UNDO_KIND, TASKS_MAX, PERSONAL };
