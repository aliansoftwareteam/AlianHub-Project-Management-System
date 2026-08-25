const logger = require('../../Config/loggerConfig');
const { WELCOME_PROJECT_NAME, demoTasksForFocus } = require('../../utils/sampleTasks');

// A brand-new company lands on an empty dashboard, which teaches nothing. This creates one
// clearly-labelled sample project whose tasks explain the product by being read, and which the
// owner can delete in one go from the project menu.
//
// Deliberately fire-and-forget and deliberately silent on failure: a company must still be usable
// if the sample content cannot be created. It goes through the normal createProject path rather
// than inserting a project document directly, because that path is what assembles the status,
// type, app and view data a project needs to render at all.
//
// The tasks are not created here. createProject seeds them from utils/sampleTasks once the
// project's first sprint exists, keyed on TemplateName.
function createDemoProject(companyId, userId, teamFocus) {
    return new Promise((resolve) => {
        try {
            if (!companyId || !userId) {
                resolve(false);
                return;
            }

            // Required late so a circular require through the createProject controller cannot
            // affect module load order during install.
            const { createProject } = require('../createProject/controller');

            const req = {
                body: {
                    CompanyId: String(companyId),
                    ProjectName: WELCOME_PROJECT_NAME,
                    ProjectCode: 'WELCOME',
                    source: 'other',
                    isTemplate: true,
                    TemplateName: WELCOME_PROJECT_NAME,
                    // Composed from what the owner said their team does, so the sample content is
                    // relevant rather than generic. Falls back to the plain walkthrough.
                    sampleTaskRows: demoTasksForFocus(teamFocus),
                    projectCreatedBy: String(userId),
                    AssigneeUserId: [String(userId)],
                    LeadUserId: [String(userId)],
                    description: 'Example content, safe to delete. Every task in here explains one part of AlianHub.',
                    // Key-only arrays, the same shape the create-project screen sends. The
                    // controller fills in the names and colours from the company's own settings,
                    // so this stays correct even if a company edits them later.
                    // 1 To Do, 3 In Progress, 6 Done, 2 Complete — seeded by importTaskDefaultStatus.
                    taskStatusData: [{ key: 1 }, { key: 3 }, { key: 6 }, { key: 2 }],
                    projectStatusData: [{ key: 1 }],
                    taskTypeCounts: [{ key: 1 }],
                },
            };

            createProject(req)
                .then(() => resolve(true))
                .catch((error) => {
                    logger.error(`createDemoProject skipped: ${error && (error.statusText || error.message)}`);
                    resolve(false);
                });
        } catch (error) {
            logger.error(`createDemoProject skipped: ${error.message}`);
            resolve(false);
        }
    });
}

module.exports = { createDemoProject };
