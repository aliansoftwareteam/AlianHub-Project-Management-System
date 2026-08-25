const logger = require('../../Config/loggerConfig');
const { dbCollections, settingsCollectionDocs } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { WELCOME_PROJECT_NAME, demoTasksForFocus } = require('../../utils/sampleTasks');

// A brand-new company lands on an empty dashboard, which teaches nothing. This creates one
// clearly-labelled sample project whose tasks explain the product by being read, and which the
// owner can delete in one go from the project menu.
//
// It goes through the normal createProject path rather than inserting a project document directly,
// because that path is what assembles the status, type, app and view data a project needs to render.
// That path expects the same payload the create-project screen sends, so the apps and views are read
// from the company's own seeded catalogues rather than guessed — their ids differ per company, and
// createProject matches on them by _id.
//
// Deliberately fire-and-forget and deliberately silent on failure: a company must still be usable if
// the sample content cannot be created.
async function createDemoProject(companyId, userId, teamFocus) {
    try {
        if (!companyId || !userId) return false;

        const cid = String(companyId);
        const uid = String(userId);

        const [apps, tabs, projectStatus] = await Promise.all([
            MongoDbCrudOpration(cid, { type: dbCollections.APPS, data: [{}] }, 'find'),
            MongoDbCrudOpration(cid, { type: dbCollections.PROJECT_TAB_COMPONENTS, data: [{}] }, 'find'),
            MongoDbCrudOpration(cid, {
                type: dbCollections.SETTINGS,
                data: [{ name: settingsCollectionDocs.PROJECT_STATUS }],
            }, 'find'),
        ]);

        const tabList = Array.isArray(tabs) ? tabs : [];
        // What a normal new project gets, plus the board — one of the getting-started steps points at
        // it, and having to add the view first would be friction.
        const views = tabList.filter((t) => t
            && (t.viewStatus === true || String(t.value).toLowerCase() === 'board'));
        if (!views.length) {
            logger.error(`createDemoProject skipped: ${cid} has no project views seeded yet`);
            return false;
        }

        const defaultView = tabList.find((t) => t && t.setAsDefault === true) || views[0];
        const statuses = (projectStatus && projectStatus[0] && projectStatus[0].settings) || [];
        const firstStatus = statuses.find((s) => s && s.isDeleted !== true);
        if (!firstStatus) {
            logger.error(`createDemoProject skipped: ${cid} has no project statuses seeded yet`);
            return false;
        }

        // Required late so a circular require through the createProject controller cannot affect
        // module load order during install.
        const { createProject } = require('../createProject/controller');

        const req = {
            body: {
                CompanyId: cid,
                ProjectName: WELCOME_PROJECT_NAME,
                ProjectCode: 'WELCOME',
                source: 'other',
                isTemplate: true,
                TemplateName: WELCOME_PROJECT_NAME,
                TemplateId: '',
                // Composed from what the owner said their team does, so the sample content is
                // relevant rather than generic. Falls back to the plain walkthrough.
                sampleTaskRows: demoTasksForFocus(teamFocus),
                projectCreatedBy: uid,
                AssigneeUserId: [uid],
                LeadUserId: [uid],
                // createProject throws rather than rejects when this is absent — its guard reads
                // Object.keys() on it before checking whether it exists.
                projectIcon: { type: 'color', data: '#6473e8' },
                ProjectType: 'Fix',
                status: firstStatus.value,
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
                TaskTypeTemplateId: '',
                projectStatusTemplateId: '',
                TemplateTaskStatusId: '',
                // Key-only arrays, the same shape the create-project screen sends. The controller
                // fills in names and colours from the company's own settings, so this stays correct
                // even if a company edits them later.
                // 1 To Do, 3 In Progress, 6 Done, 2 Complete — seeded by importTaskDefaultStatus.
                taskStatusData: [{ key: 1 }, { key: 3 }, { key: 6 }, { key: 2 }],
                projectStatusData: statuses.filter((s) => s && s.isDeleted !== true),
                taskTypeCounts: [{ key: 1 }],
                // Matched by _id against the company's own catalogues.
                apps: (Array.isArray(apps) ? apps : []).map((a) => ({ _id: a._id })),
                ProjectRequiredComponent: views.map((v) => ({ _id: v._id })),
                ProjectRequiredDefaultComponent: defaultView.keyName,
            },
        };

        await createProject(req);
        logger.info(`createDemoProject: sample project created for ${cid}`);
        return true;
    } catch (error) {
        logger.error(`createDemoProject skipped: ${(error && (error.statusText || error.message)) || error}`);
        return false;
    }
}

module.exports = { createDemoProject };
