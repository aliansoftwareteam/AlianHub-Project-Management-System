const crypto = require('crypto');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const socketEmitter = require('../../event/socketEventEmitter');
const tools = require('../Automations/engine/tools');
const { storedProject, whoOf } = require('./taskRequests');

// A tag added to a project's own list of tags. It waits for a person (proposeOnly, registry/tags.js); approved, it
// is added by the project's tag route as the person behind the agent, which asks that person's tag permission.
// Taking it back removes it only while no task carries it.

const ACTION = 'tag.create';
const KIND = 'projectTag';
const NAME_MAX = 50;
const COLOR = /^#[0-9a-f]{6}$/i;
const PALETTE = Object.freeze(['#E5484D', '#F76B15', '#FFB224', '#46A758', '#12A594', '#0091FF', '#6E56CF', '#D6409F']);
const TEXT_MAX = 250;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const refuse = (message) => new tools.DeterministicError(message);
const idOf = (value) => (value === undefined || value === null ? '' : String(value));
const setup = () => require('./setupRequests');
const lower = (value) => String(value).trim().toLowerCase();

const nameOf = (value) => setup().lineOf(value, NAME_MAX + 1);

const tagProblem = (given) => {
    const asked = given && typeof given === 'object' ? given : {};
    const name = nameOf(asked.name);
    if (!name) return 'name needs some text';
    if (name.length > NAME_MAX) return `name can be at most ${NAME_MAX} characters`;
    if (asked.color !== undefined && !COLOR.test(String(asked.color))) return 'color must be written #RRGGBB';
    return '';
};

const colorFor = (name, asked) => {
    if (COLOR.test(String(asked || ''))) return String(asked).toUpperCase();
    const sum = [...lower(name)].reduce((total, char) => total + char.charCodeAt(0), 0);
    return PALETTE[sum % PALETTE.length];
};

const tagsOf = (project) => require('./workRequests').tagsOf(project);
const tagByName = (project, name) => tagsOf(project).find((tag) => lower(tag.tagName || '') === lower(name)) || null;
const alreadyThere = (tag) => `The project already has the tag "${tag.tagName}" (${tag.uid}). Put it on a task with task.tags.add.`;

const DUPLICATE = 409;

const tagWrite = async ({ companyId, who, projectId, items, operation }, fallback) => {
    const answer = await setup().answerOf('projectTags', { companyId, who, body: { id: projectId, items, operation } });
    if (answer.code === DUPLICATE) {
        const held = tagByName(await storedProject(companyId, projectId), items.tagName);
        throw refuse(held ? alreadyThere(held) : setup().reasonOf(answer, fallback));
    }
    if (answer.code !== 200 || !answer.body || answer.body.status !== true) throw refuse(setup().reasonOf(answer, fallback));
};

const announce = async (companyId, projectId, change) => {
    const project = await storedProject(companyId, projectId);
    socketEmitter.emit('update', { type: 'update', companyId: String(companyId), data: project, updatedFields: { tagsArray: change }, module: 'project' });
};

const createTag = async ({ companyId, who, projectId, name: asked, color }) => {
    const problem = tagProblem({ name: asked, color });
    if (problem) throw refuse(problem);
    const project = await storedProject(companyId, projectId);
    const inProject = idOf(project._id);
    const name = nameOf(asked);
    const held = tagByName(project, name);
    if (held) throw refuse(alreadyThere(held));
    const tagColor = colorFor(name, color);
    const tag = { uid: crypto.randomBytes(6).toString('hex'), tagName: name, tagColor, tagBgColor: `${tagColor}35` };
    await tagWrite({ companyId, who, projectId: inProject, items: tag, operation: 'push' }, 'The tag was not added. Try again, or tell the person.');
    await announce(companyId, inProject, 'add');
    return { project, projectId: inProject, tag };
};

const carried = (companyId, projectId, uid) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS, data: [{ ProjectID: { $in: idForms(projectId) }, tagsArray: String(uid) }, { _id: 1 }],
}, 'findOne');

/* A task in the trash counts too: restored, it would carry a tag the project no longer has. */
const withdrawTag = async ({ companyId, who, projectId, tagId }) => {
    const project = await storedProject(companyId, projectId);
    const inProject = idOf(project._id);
    const tag = tagsOf(project).find((entry) => String(entry.uid) === idOf(tagId));
    if (!tag) return { projectId: inProject, removed: false };
    const kept = refuse(`The tag "${tag.tagName}" was kept: a task carries it now. Take it off those tasks first, or remove the tag in AlianHub.`);
    if (await carried(companyId, inProject, tag.uid)) throw kept;
    await tagWrite({ companyId, who, projectId: inProject, items: { id: String(tag.uid) }, operation: 'delete' }, 'The tag was not removed. Try again, or tell the person.');
    // A task may take the tag between the check and the removal; it is put back as it was.
    if (await carried(companyId, inProject, tag.uid)) {
        await tagWrite({ companyId, who, projectId: inProject, items: { ...tag }, operation: 'push' }, 'The tag was removed while a task carried it, and could not be put back. Tell the person.');
        throw kept;
    }
    await announce(companyId, inProject, 'remove');
    return { projectId: inProject, removed: true, name: tag.tagName || '' };
};

const executors = {
    async [ACTION]({ companyId, actor, params, depth }) {
        const made = await createTag({ companyId, who: whoOf(actor, depth), projectId: params.projectId, name: params.name, color: params.color });
        return {
            result: { projectId: made.projectId, tagId: made.tag.uid, name: made.tag.tagName, color: made.tag.tagColor },
            undo: { kind: KIND, projectId: made.projectId, tagId: made.tag.uid },
            entityType: 'project', entityId: made.projectId, entityName: made.project.ProjectName || '',
        };
    },
};

const inverses = {
    [KIND]: (companyId, made, actor) => withdrawTag({ companyId, who: whoOf(actor), projectId: made.projectId, tagId: made.tagId }),
};

const textOf = (value) => (typeof value === 'string' ? value.trim().slice(0, TEXT_MAX) : '');

/* The tag is the project's own: a viewer who cannot open the project has no card. */
const preview = (change, { named }) => {
    const params = change && change.params && typeof change.params === 'object' ? change.params : {};
    const projectId = OBJECT_ID.test(idOf(params.projectId)) ? idOf(params.projectId) : '';
    const project = projectId ? named.project(projectId).name : null;
    const title = textOf(params.name);
    if (!project || !title) return null;
    return { kind: 'tag', title, lines: [{ kind: 'place', project, list: '' }] };
};

module.exports = {
    executors, inverses, tagProblem, nameOf, tagByName, alreadyThere, createTag, withdrawTag,
    BUILDERS: Object.freeze({ [ACTION]: preview }), ACTION, KIND, NAME_MAX,
};
