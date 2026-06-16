const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { verifyToken, logTokenActivity } = require('./controller');
const { hasScope } = require('./helpers/apiTokenRules');

// Token-authenticated public REST namespace (/api/public-v1/*). Fully
// self-contained: its own middleware, zero coupling with the session-JWT
// auth the web app uses. Clients send:
//   Authorization: Bearer ahp_…        companyId: <company id>

const tokenAuth = async (req, res, next) => {
    const started = Date.now();
    try {
        const companyId = req.headers['companyid'] || '';
        const auth = String(req.headers['authorization'] || '');
        const rawToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
        const tokenDoc = await verifyToken(companyId, rawToken);
        if (!tokenDoc) {
            return res.status(401).send({ status: false, statusText: 'Invalid or expired API token.' });
        }
        req.apiToken = tokenDoc;
        req.apiCompanyId = companyId;
        res.on('finish', () => {
            logTokenActivity(companyId, tokenDoc._id, {
                method: req.method,
                path: req.originalUrl.split('?')[0],
                statusCode: res.statusCode,
                durationMs: Date.now() - started,
                ip: req.ip || '',
            });
        });
        return next();
    } catch (error) {
        logger.error(`ERROR in token auth: ${error.message}`);
        return res.status(500).send({ status: false, statusText: 'Token verification failed.' });
    }
};

const requireScope = (scope) => (req, res, next) => {
    if (!hasScope(req.apiToken, scope)) {
        return res.status(403).send({ status: false, statusText: `Token lacks the '${scope}' scope.` });
    }
    return next();
};

/* GET /api/public-v1/projects */
const listProjects = async (req, res) => {
    try {
        const projects = await MongoDbCrudOpration(req.apiCompanyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [{ deletedStatusKey: { $in: [0, undefined] } }, 'ProjectName ProjectCode createdAt', { limit: 200 }],
        }, 'find');
        return res.send({ status: true, data: projects || [] });
    } catch (error) {
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

/* GET /api/public-v1/tasks?projectId=&limit= */
const listTasks = async (req, res) => {
    try {
        const projectId = String(req.query?.projectId || '');
        if (!/^[0-9a-fA-F]{24}$/.test(projectId)) {
            return res.status(400).send({ status: false, statusText: 'A valid projectId query param is required.' });
        }
        const limit = Math.min(500, Math.max(1, Number(req.query?.limit) || 100));
        const tasks = await MongoDbCrudOpration(req.apiCompanyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [
                { ProjectID: new mongoose.Types.ObjectId(projectId), deletedStatusKey: { $ne: 1 } },
                'TaskKey TaskName status statusType Task_Priority AssigneeUserId DueDate sprintId epicId createdAt updatedAt',
                { limit, sort: { updatedAt: -1 } },
            ],
        }, 'find');
        return res.send({ status: true, data: tasks || [] });
    } catch (error) {
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

/* GET /api/public-v1/tasks/:key — lookup by TaskKey (e.g. AH-12). */
const getTaskByKey = async (req, res) => {
    try {
        const key = String(req.params?.key || '').trim();
        if (!key || key.length > 40) {
            return res.status(400).send({ status: false, statusText: 'A task key is required.' });
        }
        const task = await MongoDbCrudOpration(req.apiCompanyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ TaskKey: key, deletedStatusKey: { $ne: 1 } }],
        }, 'findOne');
        if (!task) {
            return res.status(404).send({ status: false, statusText: 'Task not found.' });
        }
        return res.send({ status: true, data: task });
    } catch (error) {
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

exports.init = (app) => {
    app.get('/api/public-v1/projects', tokenAuth, requireScope('read'), listProjects);
    app.get('/api/public-v1/tasks/:key', tokenAuth, requireScope('read'), getTaskByKey);
    app.get('/api/public-v1/tasks', tokenAuth, requireScope('read'), listTasks);
};
