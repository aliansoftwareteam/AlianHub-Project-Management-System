const logger = require('../../Config/loggerConfig');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { WELCOME_PROJECT_NAME, demoTasksForFocus } = require('../../utils/sampleTasks');
const { TemplateData: builtInTaskTypeTemplates } = require('../../utils/Tempates/task_type');

// A brand-new company lands on an empty dashboard, which teaches nothing. This creates one
// clearly-labelled sample project whose tasks explain the product by being read.
//
// It must behave exactly like a project someone made by hand — the whole point is that a new user
// can try everything in it. So it goes through the normal createProject path, and its payload is
// assembled the same way the create-project screen assembles one: from the company's own seeded
// TEMPLATES, not from loose keys.
//
// That distinction is what broke it before. The screen builds taskStatusData out of the task-status
// template, tagging each entry `default_active`, `active`, `done` or `close`. The create-task form
// then looks for the entry whose type is `default_active` to decide a new task's status. A project
// whose statuses carry no type has nothing for it to find, so every new task in the demo project
// failed validation with a missing statusKey — while the project itself looked perfectly fine.
//
// Deliberately fire-and-forget and deliberately silent on failure: a company must still be usable
// if the sample content cannot be created.

// Mirrors the create-project screen: one flat list, each entry tagged with what it is.
function buildTaskStatusData(template) {
    const entry = (src, type) => ({
        name: src.name,
        bgColor: `${src.textColor}35`,
        textColor: src.textColor,
        key: src.key,
        statusImage: '',
        isDeleted: true,
        type,
    });

    const out = [];
    if (template.defaultActive && template.defaultActive.key !== undefined) {
        out.push(entry(template.defaultActive, 'default_active'));
    }
    for (const s of template.ActiveStatusList || []) out.push(entry(s, 'active'));
    for (const s of template.DoneStatusList || []) out.push(entry(s, 'done'));
    if (template.defaultComplete && template.defaultComplete.key !== undefined) {
        out.push(entry(template.defaultComplete, 'close'));
    }
    return out;
}

const pickDefault = (list) => (Array.isArray(list)
    ? (list.find((x) => x && x.default === true) || list[0] || null)
    : null);

/* The createProject request the create-project screen would send for `userId`, built from the
 * company's own templates. `fields` overrides any key (name, code, members). Throws when the
 * company has not been seeded with templates yet. */
async function projectRequestFromTemplates(companyId, userId, fields = {}) {
    const cid = String(companyId);
    const uid = String(userId);

    const [apps, tabs, taskStatusTemplates, taskTypeTemplates, projectStatusTemplates] = await Promise.all([
        MongoDbCrudOpration(cid, { type: dbCollections.APPS, data: [{}] }, 'find'),
        MongoDbCrudOpration(cid, { type: dbCollections.PROJECT_TAB_COMPONENTS, data: [{}] }, 'find'),
        MongoDbCrudOpration(cid, { type: dbCollections.TASK_STATUS_TEMPLATES, data: [{}] }, 'find'),
        MongoDbCrudOpration(cid, { type: dbCollections.TASK_TYPE_TEMPLATES, data: [{}] }, 'find'),
        MongoDbCrudOpration(cid, { type: dbCollections.PROJECT_STATUS_TEMPLATES, data: [{}] }, 'find'),
    ]);

    const statusTemplate = pickDefault(taskStatusTemplates);
    // Companies created before task types were seeded have no template; the create-project screen then
    // stores the built-in types with an empty template id, which is what importTaskTypeTemplate would seed.
    const typeTemplate = pickDefault(taskTypeTemplates) || { ...pickDefault(builtInTaskTypeTemplates()), _id: '' };
    const projectStatusTemplate = pickDefault(projectStatusTemplates);
    if (!statusTemplate || !typeTemplate || !projectStatusTemplate) {
        throw new Error(`${cid} has no seeded templates yet`);
    }

    const taskStatusData = buildTaskStatusData(JSON.parse(JSON.stringify(statusTemplate)));
    if (!taskStatusData.some((s) => s.type === 'default_active')) {
        throw new Error(`${cid} status template has no default active status`);
    }

    const projectStatusData = [
        ...(projectStatusTemplate.projectActiveStatus || []),
        ...(projectStatusTemplate.projectDoneStatus || []),
        ...(projectStatusTemplate.projectCompletedStatus ? [projectStatusTemplate.projectCompletedStatus] : []),
    ];
    const openStatus = pickDefault(projectStatusTemplate.projectActiveStatus);
    if (!openStatus) {
        throw new Error(`${cid} has no project statuses seeded yet`);
    }

    const tabList = Array.isArray(tabs) ? tabs : [];
    // Picked by keyName, not by the catalogue's viewStatus/setAsDefault flags: the seed writes
    // those false on every row, because they are a per-project choice the create-project screen
    // makes rather than a catalogue default.
    const WANTED = ['ProjectListView', 'ProjectKanban', 'ProjectDetail', 'Comments', 'ActivityLog', 'Workload'];
    const DEFAULT_VIEW = 'ProjectListView';
    let chosen = tabList.filter((t) => t && WANTED.includes(t.keyName));
    if (!chosen.length) chosen = tabList.slice(0, 1);
    if (!chosen.length) {
        throw new Error(`${cid} has no project views seeded yet`);
    }

    // _id as a STRING: createProject matches these against the catalogue with === on a
    // JSON-stringified id, so an ObjectId here never matches and the view keeps no name —
    // which renders as "ViewList.undefined" in the tabs.
    const views = chosen.map((v) => ({
        _id: String(v._id),
        viewStatus: true,
        setAsDefault: v.keyName === DEFAULT_VIEW,
    }));
    const defaultViewKey = (chosen.find((v) => v.keyName === DEFAULT_VIEW) || chosen[0]).keyName;

    return {
        body: {
            CompanyId: cid,
            source: 'other',
            isTemplate: true,
            TemplateId: '',
            projectCreatedBy: uid,
            AssigneeUserId: [uid],
            LeadUserId: [uid],
            // createProject throws rather than rejects when this is absent — its guard reads
            // Object.keys() on it before checking whether it exists.
            projectIcon: { type: 'color', data: '#6473e8' },
            ProjectType: 'Fix',
            status: openStatus.value,
            statusType: 'active',
            markAsStar: false,
            isPrivateSpace: false,
            isGlobalPermission: true,
            lastTaskId: 0,
            sprintsfolders: {},
            sprintsObj: {},
            DueDate: '',
            proposalId: '',
            skills: [],
            customFiedlsValue: [],
            ProjectCurrency: {},

            // The template ids matter: the project settings screen uses them to tell whether a
            // project still matches its template or has been customised.
            taskStatusData,
            TemplateTaskStatusId: String(statusTemplate._id),
            taskTypeCounts: typeTemplate.taskTypes || [],
            TaskTypeTemplateId: String(typeTemplate._id),
            projectStatusData,
            projectStatusTemplateId: String(projectStatusTemplate._id),

            // Apps travel as keys. ALL of them, not just the ones the seed marks active — the
            // sample tasks teach time tracking and tagging, so the demo project has the
            // features its own content points at.
            apps: (Array.isArray(apps) ? apps : []).map((a) => a && a.key).filter(Boolean),
            ProjectRequiredComponent: views,
            ProjectRequiredDefaultComponent: defaultViewKey,
            ...fields,
        },
    };
}

async function createDemoProject(companyId, userId, teamFocus) {
    try {
        if (!companyId || !userId) return false;

        const req = await projectRequestFromTemplates(companyId, userId, {
            ProjectName: WELCOME_PROJECT_NAME,
            ProjectCode: 'WELCOME',
            TemplateName: WELCOME_PROJECT_NAME,
            // Composed from what the owner said their team does, so the sample content is
            // relevant rather than generic. Falls back to the plain walkthrough.
            sampleTaskRows: demoTasksForFocus(teamFocus),
        });

        // Required late so a circular require through the createProject controller cannot affect
        // module load order during install.
        const { createProject } = require('../createProject/controller');

        await createProject(req);
        logger.info(`createDemoProject: sample project created for ${String(companyId)}`);
        return true;
    } catch (error) {
        logger.error(`createDemoProject skipped: ${(error && (error.statusText || error.message)) || error}`);
        return false;
    }
}

module.exports = { createDemoProject, buildTaskStatusData, projectRequestFromTemplates };
