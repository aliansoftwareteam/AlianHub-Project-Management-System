const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const socketEmitter = require('../../event/socketEventEmitter');
const tools = require('../Automations/engine/tools');
const permissions = require('./permissions');
const setup = require('./setupRequests');
const plans = require('./projectSetup');
const { storedProject, whoOf } = require('./taskRequests');

// A new project an agent asked for. Nothing is made until a person approves it. Then the project is made by the route
// the Create project screen calls, as the person who approved, with the body that screen sends for a blank project:
// private, and with only that person on it. The plan that came with it runs as a plan does for a project that exists
// (./projectSetup.js), so each part is held to the person behind the agent and to the approver. Taking it back moves
// the project to the trash, as the project's own Delete does, and never while it holds a task or a doc.

const ACTION = 'project.create';
const UNDO_KIND = 'project';
const NAME_MIN = 3;
const NAME_MAX = 100;
const DESCRIPTION_MAX = 2000;
const CODE_LETTERS = 6;
const CODE_TRIES = 200;
const CODE_FALLBACK = 'P';
const ICON_COLOURS = Object.freeze(['#2F3990', '#2f9e7e', '#d98324', '#6b5ce7', '#0EA5E9', '#EC4899', '#14B8A6', '#F97316']);
const DESCRIPTION = 'description';
const DESCRIPTION_KEY = 'project.project_description';
const TRASHED = 1;
const NOT_ON_IT = 'the person who asked for this project is not on it yet, so this part was not made; add them to the project, then set it up from there';

const blank = () => require('../createProject/blankTemplate');
const refuse = (message) => new tools.DeterministicError(message);
const idOf = (value) => (value === undefined || value === null ? '' : String(value));
const listOf = (value) => (Array.isArray(value) ? value : []);
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);

const nameOf = (value) => setup.lineOf(value, NAME_MAX);
const descriptionOf = (value) => (typeof value === 'string' ? value.trim().slice(0, DESCRIPTION_MAX) : '');

/* What a caller names, kept as plain text: the project's name, what it is for, and the plan project.setup takes. */
const draftOf = (given) => {
    const asked = objectOf(given);
    const description = descriptionOf(asked.description);
    return { name: nameOf(asked.name), ...(description ? { description } : {}), ...plans.planOf(asked) };
};

/* The kinds of view a blank project starts with, which are the ones a view of the plan can start from. */
const viewKinds = () => {
    const made = listOf(blank().TemplateRequiredComponent).map((view) => view.keyName);
    return Object.keys(setup.VIEW_KINDS).filter((kind) => made.includes(setup.VIEW_KINDS[kind]));
};

const startingStatuses = () => listOf(blank().taskStatusData).map((status) => status.name);

const viewKindProblem = (plan) => {
    const offered = viewKinds();
    const other = listOf(plan.views).find((view) => !offered.includes(view.kind));
    return other ? `"${other.name}" is a ${other.kind} view, and a new project starts with ${offered.join(' and ')} views only; add that view once the project is there` : '';
};

const hasPlan = (asked) => plans.PARTS.some((part) => asked[part] !== undefined) || asked.definitions !== undefined;

/* '' for a project that can be asked for; otherwise what is wrong with the request. */
const problemIn = (given) => {
    const asked = objectOf(given);
    if (nameOf(asked.name).length < NAME_MIN) return `name needs ${NAME_MIN} to ${NAME_MAX} characters`;
    if (asked.description !== undefined && typeof asked.description !== 'string') return 'description needs text';
    if (!hasPlan(asked)) return '';
    return plans.planProblem(asked) || viewKindProblem(plans.planOf(asked));
};

const partsAsked = (draft) => [...(draft.description ? [DESCRIPTION] : []), ...plans.partsOf(draft)];

/* The keys the web app asks for a part of a project, each entry met by any one of its keys. */
const keyGroupsOf = (part, uid) => (part === DESCRIPTION ? [[DESCRIPTION_KEY]] : plans.keysOf(part, uid).map((keys) => [].concat(keys)));

/* A new project follows the company's rules, so what a person may make in one they create is read from those. */
const lackedInNew = async (companyId, uid, part) => {
    if (part === 'fields') {
        const held = await permissions.holderMay(companyId, { kind: 'human', userId: uid }, 'fields.create', {});
        return held.allowed ? '' : `${held.permission} is not granted`;
    }
    const { evaluatePermission, isWritable, fineGrainedEnforced } = require('../../Config/permissionGuard');
    if (!fineGrainedEnforced()) return '';
    for (const keys of keyGroupsOf(part, uid)) {
        let held = false;
        for (const key of keys) held = held || isWritable(await evaluatePermission(companyId, uid, key));
        if (!held) return `${keys[0]} is not granted`;
    }
    return '';
};

const mayCreate = (companyId, uid) => permissions.holderMay(companyId, { kind: 'human', userId: idOf(uid) }, ACTION, {});

/* What stops `uid` from making this by hand: the project itself, or the parts of its plan, each with the reason. */
const refusedFor = async (companyId, uid, draft) => {
    const own = await mayCreate(companyId, uid);
    if (!own.allowed) return { project: `${own.permission} is not granted`, parts: [] };
    const parts = [];
    for (const part of partsAsked(draft)) {
        const reason = await lackedInNew(companyId, idOf(uid), part);
        if (reason) parts.push({ part, reason });
    }
    return { project: '', parts };
};

const iconColourFor = (name) => {
    const hash = Array.from(name).reduce((sum, letter) => (sum * 31 + letter.charCodeAt(0)) >>> 0, 7);
    return ICON_COLOURS[hash % ICON_COLOURS.length];
};

/* The key the Create project screen suggests for a name: the first letter of each word. */
const lettersOf = (name) => (name.match(/\b(\w)/g) || []).join('').toUpperCase().slice(0, CODE_LETTERS) || CODE_FALLBACK;

const codeTaken = async (companyId, code) => Boolean(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ ProjectCode: code }, { _id: 1 }] }, 'findOne'));

const codeFor = async (companyId, name) => {
    const letters = lettersOf(name);
    for (let at = 1; at <= CODE_TRIES; at += 1) {
        const code = at === 1 ? letters : `${letters}${at}`;
        if (!(await codeTaken(companyId, code))) return code;
    }
    throw refuse('No free project key was found. Ask the person to create the project in AlianHub under Projects.');
};

/* The body the Create project screen sends for its Blank choice, for `uid` alone. */
const bodyFor = ({ uid, name, code }) => ({
    AssigneeUserId: [uid], LeadUserId: [], ProjectName: name, ProjectCode: code, ProjectType: 'Fix', markAsStar: false, sprintsObj: {}, sprintsfolders: {},
    DueDate: '', proposalId: '', skills: [], source: 'other', projectIcon: { type: 'color', data: iconColourFor(name) },
    TemplateName: '', TemplateId: blank()._id, useTemplateProj: 'category', isTemplate: false, isPrivateSpace: true, TaskTypeTemplateId: '', statusType: 'active', lastTaskId: 0,
    ProjectRequiredDefaultComponent: (listOf(blank().TemplateRequiredComponent).find((view) => view.setAsDefault) || {}).keyName || 'ProjectListView',
    ProjectCurrency: {}, isGlobalPermission: true, customFiedlsValue: [], includeSampleTasks: false, sampleFocus: '',
    apps: listOf(blank().apps).filter((app) => app.appStatus).map((app) => app.key),
});

const createAs = async ({ companyId, who, name }) => {
    const answer = await setup.answerOf('projectCreate', { companyId, who, body: bodyFor({ uid: who.uid, name, code: await codeFor(companyId, name) }) });
    const saved = answer.code === 200 && answer.body && answer.body.status === true && answer.body.data;
    if (!saved || !saved._id) throw refuse(setup.reasonOf(answer, 'The project was not created. Try again, or tell the person.'));
    const project = await storedProject(companyId, saved._id);
    socketEmitter.emit('insert', { type: 'insert', companyId: String(companyId), data: project, module: 'project' });
    return project;
};

/* The description is saved as the project screen saves it, by the approver, and only where the person behind the agent may write one too. */
const describe = async ({ companyId, requester, approver, projectId, text }) => {
    const { canEditProject } = require('../../Config/projectAccess');
    const { descriptionBlockFrom } = require('../Tasks/helpers/descriptionBlock');
    const own = await canEditProject(companyId, requester.uid, projectId, [DESCRIPTION_KEY]);
    if (!own.allowed) return `${permissions.REASON}: ${DESCRIPTION_KEY} is not granted`;
    const answer = await setup.answerOf('projectUpdate', { companyId, who: approver, params: { id: projectId }, body: { updateObject: { descriptionBlock: descriptionBlockFrom(text) } } });
    if (answer.code !== 200) return answer.code === 403 ? `The person approving may not make this part: ${DESCRIPTION_KEY} is not granted` : setup.reasonOf(answer, 'The description was not saved.');
    socketEmitter.emit('update', { type: 'update', companyId: String(companyId), data: await storedProject(companyId, projectId), updatedFields: { descriptionBlock: 'set' }, module: 'project' });
    return '';
};

const descriptionPart = (error) => ({ part: DESCRIPTION, ok: !error, ...(error ? { error } : {}), items: error ? [] : [{ name: DESCRIPTION, made: true }] });

const noneMade = (draft, error) => partsAsked(draft).map((part) => ({ part, ok: false, error, items: [] }));

const partsMade = async ({ companyId, requester, approver, projectId, draft }) => {
    const { canEditProject } = require('../../Config/projectAccess');
    if (!(await canEditProject(companyId, requester.uid, projectId)).allowed) return noneMade(draft, NOT_ON_IT);
    const described = draft.description ? [descriptionPart(await describe({ companyId, requester, approver, projectId, text: draft.description }))] : [];
    const planned = plans.partsOf(draft).length ? await plans.carryOut({ companyId, who: requester, approvedBy: approver.uid, projectId, plan: draft }) : [];
    return [...described, ...planned];
};

/* Every part that came with the project, each answered on its own. A person who asked and is not on the new project
 * makes none of them. The project is there by now, so nothing here throws: the change must end with its undo. */
const carryOut = async (given) => {
    if (!partsAsked(given.draft).length) return [];
    return partsMade(given).catch((error) => noneMade(given.draft, error.message));
};

const notMadeIn = (parts, draft) => {
    const described = parts.filter((entry) => entry.part === DESCRIPTION && entry.error).map((entry) => ({ part: DESCRIPTION, name: DESCRIPTION, error: entry.error }));
    return [...described, ...plans.notMadeIn(parts.filter((entry) => entry.part !== DESCRIPTION), draft)];
};

const addressOf = (companyId, projectId) => {
    const base = require('../Mcp/screenTools').webBase();
    return base ? `${base}/#/${encodeURIComponent(String(companyId))}/project/${projectId}/p` : '';
};

const liveIn = (companyId, type, projectId, except = []) => MongoDbCrudOpration(companyId, {
    type, data: [{ ProjectID: { $in: idForms(projectId) }, deletedStatusKey: { $ne: TRASHED }, ...(except.length ? { _id: { $nin: except.map(tools.oid) } } : {}) }, { _id: 1 }],
}, 'findOne');

const heldIn = async (companyId, projectId, startedWith) => {
    if (await liveIn(companyId, SCHEMA_TYPE.TASKS, projectId, startedWith)) return startedWith.length ? 'a task that was not part of the copy' : 'a task now';
    return await liveIn(companyId, SCHEMA_TYPE.PAGES, projectId) ? 'a doc now' : '';
};

/* Taking a project back moves it to the trash through the project's own route, as the person undoing, who must be
 * allowed to delete it by hand. A person restores it from the trash. A project that holds work by then stays, and
 * the undo is refused with the reason, so the person is told and can undo again once the work is moved. The tasks a
 * copy was made with (`startedWith`) are not work made since. */
const withdraw = async ({ companyId, who, projectId, startedWith = [] }) => {
    const project = await storedProject(companyId, projectId);
    const inProject = idOf(project._id);
    const name = project.ProjectName || '';
    const held = await heldIn(companyId, inProject, startedWith);
    if (held) throw refuse(`The project "${name}" has ${held}, so it was kept. A person can delete it in AlianHub if it should go.`);
    const answer = await setup.answerOf('projectUpdate', { companyId, who, params: { id: inProject }, body: { updateObject: { deletedStatusKey: TRASHED } } });
    if (answer.code !== 200) throw refuse(answer.code === 403 ? `The person is not allowed to delete the project "${name}", so it was kept.` : setup.reasonOf(answer, 'the project was not moved to the trash'));
    socketEmitter.emit('update', { type: 'update', companyId: String(companyId), data: { ...plain(project), deletedStatusKey: TRASHED }, updatedFields: { deletedStatusKey: TRASHED }, module: 'project' });
    return { projectId: inProject, name, trashed: true };
};

const executors = {
    async [ACTION]({ companyId, actor, params, depth, approvedBy }) {
        const approverId = idOf(approvedBy);
        if (!approverId) throw refuse('A project is made only after a person approves it.');
        const problem = problemIn(params);
        if (problem) throw refuse(problem);
        const draft = draftOf(params);
        const requester = whoOf(actor, depth);
        const own = await mayCreate(companyId, approverId);
        if (!own.allowed) throw refuse(`The person approving may not create a project (${own.permission} is not granted).`);
        const approver = { uid: approverId, via: requester.via, mark: requester.mark ? { ...requester.mark, userId: approverId } : null };
        const project = await createAs({ companyId, who: approver, name: draft.name });
        const projectId = idOf(project._id);
        const parts = await carryOut({ companyId, requester, approver, projectId, draft });
        const url = addressOf(companyId, projectId);
        return {
            result: {
                projectId, name: project.ProjectName || '', code: project.ProjectCode || '',
                made: parts.reduce((count, entry) => count + entry.items.filter((item) => item.made).length, 0),
                parts, notMade: notMadeIn(parts, draft), ...(url ? { url } : {}),
            },
            undo: { kind: UNDO_KIND, projectId },
            entityType: 'project', entityId: projectId, entityName: project.ProjectName || '',
        };
    },
};

const inverses = {
    [UNDO_KIND]: (companyId, made, actor) => withdraw({ companyId, who: whoOf(actor), projectId: made.projectId }),
};

module.exports = { executors, inverses, draftOf, problemIn, refusedFor, mayCreate, withdraw, addressOf, viewKinds, startingStatuses, ACTION, UNDO_KIND, NAME_MIN, NAME_MAX, DESCRIPTION_MAX };
