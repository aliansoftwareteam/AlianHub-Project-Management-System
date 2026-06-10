const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { dbCollections, settingsCollectionDocs } = require("../../Config/collections");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');
const { validateImportInput, transformJiraRows } = require('./helpers/jiraRules');

// Jira importer. The client parses the Jira CSV export (the xlsx lib reads
// CSV) and posts plain rows; the server maps statuses/priorities and feeds
// the existing createMultipleTasks pipeline so keys, counters and sockets
// all behave exactly like a native bulk import. Every run is recorded in
// importJobs.

/* POST /api/v2/imports/jira
 * body: { rows, projectId, sprintId, sprintName?, folderId?, folderName?, userData } */
exports.importFromJira = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { rows, projectId, sprintId, sprintName, folderId, folderName, userData } = req.body || {};
        const userId = userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '';
        const check = validateImportInput({ companyId, projectId, sprintId, rows, userId });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }

        const [project, statusDocs] = await Promise.all([
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS,
                data: [{ _id: new mongoose.Types.ObjectId(projectId) }],
            }, 'findOne'),
            MongoDbCrudOpration(companyId, {
                type: dbCollections.SETTINGS,
                data: [{ name: settingsCollectionDocs.TASK_STATUS }],
            }, 'find'),
        ]);
        if (!project) {
            return res.send({ status: false, statusText: 'Project not found.' });
        }
        const statusArray = ((statusDocs && statusDocs[0] && statusDocs[0].settings) || [])
            .map((status) => ({ name: status.name, key: status.key, type: status.type }))
            .filter((status) => status.name !== undefined);
        if (!statusArray.length) {
            return res.send({ status: false, statusText: 'No task statuses configured for this company.' });
        }

        const { tasks, skipped } = transformJiraRows({
            rows,
            statusNames: statusArray.map((status) => status.name),
            leaderId: userId,
        });
        if (!tasks.length) {
            return res.send({ status: false, statusText: 'No importable rows found (a Summary column is required).' });
        }

        const job = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.IMPORT_JOBS,
            data: {
                userId,
                source: 'jira',
                projectId: new mongoose.Types.ObjectId(projectId),
                sprintId: new mongoose.Types.ObjectId(sprintId),
                status: 'processing',
                total: tasks.length,
                processed: 0,
                created: 0,
                errors: [],
            },
        }, 'save');

        const projectData = {
            _id: project._id,
            CompanyId: companyId,
            ProjectName: project.ProjectName,
            ProjectCode: project.ProjectCode,
            lastTaskId: project.lastTaskId,
        };
        const sprint = { id: sprintId, name: sprintName || '' };
        if (folderId) {
            sprint.folderId = folderId;
            sprint.folderName = folderName || '';
        }
        const tasksWithSprint = tasks.map((task) => ({ ...task, sprintId, sprintArray: sprint }));

        try {
            const result = await taskMongo.createMultipleTasks({
                tasks: tasksWithSprint,
                userData: { id: userId, Employee_Name: userData.Employee_Name || '', companyOwnerId: userData.companyOwnerId || '' },
                projectData,
                indexObj: {},
                statusArray,
                sprint,
            });
            const createdCount = Array.isArray(result?.data) ? result.data.length : tasks.length;
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.IMPORT_JOBS,
                data: [{ _id: job._id }, { $set: { status: 'done', processed: tasks.length, created: createdCount } }],
            }, 'updateOne');
            return res.send({ status: true, statusText: `Imported ${createdCount} tasks from Jira (${skipped} rows skipped).`, data: { jobId: job._id, created: createdCount, skipped } });
        } catch (creationError) {
            logger.error(`[importers] jira job ${job._id} failed: ${creationError.message}`);
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.IMPORT_JOBS,
                data: [{ _id: job._id }, { $set: { status: 'failed', errors: [String(creationError.message || creationError).slice(0, 300)] } }],
            }, 'updateOne').catch(() => {});
            return res.send({ status: false, statusText: `Import failed: ${creationError.message}` });
        }
    } catch (error) {
        logger.error(`ERROR in jira import: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/imports?uid= — caller's import history. */
exports.listImports = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = String(req.query?.uid || '');
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and uid are required.' });
        }
        const jobs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.IMPORT_JOBS,
            data: [{ userId }, 'source status total processed created errors createdAt', { sort: { createdAt: -1 }, limit: 20 }],
        }, 'find');
        return res.send({ status: true, statusText: 'Imports fetched.', data: jobs || [] });
    } catch (error) {
        logger.error(`ERROR in list imports: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
