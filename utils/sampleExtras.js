const crypto = require('crypto');
const { removeCache } = require('./commonFunctions');
const logger = require('../Config/loggerConfig');

// Each kind goes through the helper a person's create uses, in its own try/catch so one that cannot
// be made does not lose the rest. All of it belongs to the welcome project (the goal carries `sample`),
// which is how Modules/Trash finds it again.

const FOLDER_NAME = 'Team playbook';
const SUBFOLDER_NAME = 'Weekly routines';
const SUBFOLDER_LIST_NAME = 'Recurring work';

const HOURS_FIELD = {
    key: 'hours',
    fieldTitle: 'Estimate (hours)',
    fieldType: 'number',
    fieldDescription: 'A number field. Group the list by Area and each group adds up its hours.',
};
const AREA_FIELD = {
    key: 'area',
    fieldTitle: 'Area',
    fieldType: 'dropdown',
    fieldDescription: 'A dropdown field. Pick one of its options on any task.',
    options: ['Design', 'Build', 'Review'],
};
const OPTION_COLORS = ['#2F3990', '#1E88E5', '#00897B'];

const DOC_TITLE = 'How we work';
const DOC_BLOCKS = [
    { type: 'header', data: { text: 'Working agreement', level: 2 } },
    { type: 'paragraph', data: { text: 'A doc lives in the project beside its tasks, so what the team agreed is one click from the work it is about.' } },
    {
        type: 'checklist',
        data: {
            items: [
                { text: 'Write down what done looks like', checked: true },
                { text: 'Give every task an owner', checked: false },
                { text: 'Review work before it ships', checked: false },
            ],
        },
    },
];

const GOAL_NAME = 'Finish the getting-started tasks';
const GOAL_TARGET_NAME = 'Getting started tasks done';
const GOAL_COLOR = '#6473e8';

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const safely = async (what, step) => {
    try {
        return await step();
    } catch (error) {
        logger.error(`sample ${what} skipped: ${(error && (error.statusText || error.message)) || error}`);
        return null;
    }
};

/* Returns what a task row needs to store a value: { hours: { id }, area: { id, options: { Design: '…' } } }. */
async function createSampleFields({ companyId, projectId, ownerId }) {
    const { insertCustomFieldPromise } = require('../Modules/CustomField/controller');
    const { fieldInsertFrom } = require('../Modules/CustomField/helpers/fieldWrite');
    const { fieldDefinitionFrom } = require('../Modules/Importers/helpers/clickupFields');
    const { recordFieldCreated } = require('../Modules/CustomField/helpers/customFieldHistory');

    const made = {};
    for (const spec of [HOURS_FIELD, AREA_FIELD]) {
        const options = (spec.options || []).map((label, index) => ({
            id: crypto.randomBytes(4).toString('hex'), color: OPTION_COLORS[index % OPTION_COLORS.length], value: label, label, selected: false,
        }));
        const draft = {
            fieldTitle: spec.fieldTitle,
            fieldType: spec.fieldType,
            fieldDescription: spec.fieldDescription,
            ...(options.length ? { fieldOptions: options } : {}),
        };
        // eslint-disable-next-line no-await-in-loop
        const saved = await safely(`field ${spec.fieldTitle}`, async () => plain(await insertCustomFieldPromise(
            fieldInsertFrom(fieldDefinitionFrom(draft, { projectId, userId: ownerId })), 'save', companyId,
        )));
        if (!saved) continue;
        made[spec.key] = { id: String(saved._id), options: Object.fromEntries(options.map((o) => [o.label, o.id])) };
        recordFieldCreated({ companyId, field: saved, actorId: ownerId })
            .catch((error) => logger.error(`sample field history: ${error && error.message}`));
    }
    removeCache(`customField:${companyId}`);
    return made;
}

/* A number is stored as text and a dropdown as the list of its chosen option ids, as the task panel stores them. */
function sampleFieldValues(made, values) {
    const out = {};
    if (!made || !values) return out;
    if (made.hours && values.hours !== undefined) out[made.hours.id] = { fieldValue: String(values.hours), _id: made.hours.id };
    const option = made.area && made.area.options[values.area];
    if (option) out[made.area.id] = { fieldValue: [option], _id: made.area.id };
    return out;
}


async function createSampleFolders({ project, userData }) {
    const { addFolderFun, addSprintFun } = require('../Modules/Sprints/controller');
    const companyId = String(project.CompanyId);
    const projectId = String(project._id);
    const { doc: folder } = await addFolderFun({ companyId, projectId, folderName: FOLDER_NAME });
    const { doc: subfolder } = await addFolderFun({ companyId, projectId, folderName: SUBFOLDER_NAME, parentFolderId: String(folder._id) });
    const created = await addSprintFun({
        body: {
            companyId,
            projectId,
            sprintName: SUBFOLDER_LIST_NAME,
            folder: { folderId: String(subfolder._id) },
            userData,
            projectName: project.ProjectName,
        },
    });
    if (!created || !created.data || !created.data._id) throw new Error((created && created.statusText) || 'the list was not created');
    return { folder: plain(folder), subfolder: plain(subfolder), list: plain(created.data) };
}

async function createSampleDoc({ companyId, projectId, ownerId }) {
    const { savePage } = require('../Modules/Pages/controller');
    const { contentToEditorData } = require('../Modules/Pages/helpers/pageContent');
    const { normalizeBlockMentions } = require('../Modules/Pages/helpers/pageMentions');
    const blocks = normalizeBlockMentions(contentToEditorData({ blocks: DOC_BLOCKS }));
    return savePage(companyId, ownerId, { title: DOC_TITLE, projectId, blocks });
}

/* Visibility is left at the Goals module's default, private to the owner. */
async function createSampleGoal({ companyId, ownerId, sprintId }) {
    const { saveGoal } = require('../Modules/Goals/controller');
    const caller = { companyId, uid: String(ownerId), isGuest: false, isPrivileged: true };
    return saveGoal(caller, {
        name: GOAL_NAME,
        color: GOAL_COLOR,
        targets: [{ name: GOAL_TARGET_NAME, kind: 'tasks', sources: { sprintIds: [String(sprintId)] } }],
    }, { sample: true });
}

async function addTaskToSecondList({ project, taskId, list, userData }) {
    const { placeForSample } = require('../Modules/Tasks/helpers/taskMongo/extraListPlace');
    return placeForSample({ companyId: String(project.CompanyId), taskId, list, project, userData });
}

/* Runs after the tasks exist: the second-list task is the first top-level one in the second sprint. */
async function seedSampleExtras({ project, sprints, tasks, ownerId, userData }) {
    const companyId = String(project.CompanyId);
    const projectId = String(project._id);
    const placed = await safely('folders', () => createSampleFolders({ project, userData }));
    await safely('doc', () => createSampleDoc({ companyId, projectId, ownerId }));
    if (sprints && sprints[0]) await safely('goal', () => createSampleGoal({ companyId, ownerId, sprintId: sprints[0]._id }));
    const secondHome = sprints && sprints[1] && tasks.find((t) => t.isParentTask !== false && String(t.sprintId) === String(sprints[1]._id));
    if (placed && secondHome) {
        await safely('second list', () => addTaskToSecondList({ project, taskId: String(secondHome._id), list: placed.list, userData }));
    }
    return placed;
}

module.exports = {
    FOLDER_NAME, SUBFOLDER_NAME, SUBFOLDER_LIST_NAME, HOURS_FIELD, AREA_FIELD, DOC_TITLE, GOAL_NAME,
    createSampleFields, sampleFieldValues, seedSampleExtras,
};
