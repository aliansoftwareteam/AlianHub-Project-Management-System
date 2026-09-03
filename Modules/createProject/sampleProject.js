const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { buildSamplePlan, sampleTasksFor, normaliseFocus } = require('./sampleTasks');

const SEED_TIMEOUT_MS = 30000;

// Required at call time: the orchestrator itself requires createProject/controller.
const orchestrator = () => require('../AIProjectGenerator/orchestrator');

const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

const loadUserData = async (uid, companyId) => {
    let name = '';
    try {
        const user = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: uid }] }, 'findOne');
        name = (user && user.Employee_Name) || '';
    } catch (error) {
        logger.warn(`sample project: could not resolve user ${uid}: ${error && error.message ? error.message : error}`);
    }
    return { id: String(uid), Employee_Name: name || 'Workspace owner', companyOwnerId: companyId };
};

/**
 * Creates the "Welcome to AlianHub" project for a brand-new workspace. Never
 * throws: company creation must succeed even if the sample cannot be built.
 */
exports.seedSampleProject = async ({ companyId, uid, teamFocus }) => {
    const focus = normaliseFocus(teamFocus);
    try {
        const userData = await loadUserData(uid, companyId);
        const plan = buildSamplePlan({ focus, ownerId: uid });
        const result = await withTimeout(
            orchestrator().executePlan({ plan, companyId, uid: String(uid), userData, jobId: `sample_${companyId}` }),
            SEED_TIMEOUT_MS,
            'seedSampleProject',
        );
        if (!result || !result.ok) logger.error(`sample project for ${companyId} failed: ${result && result.error}`);
        return result || { ok: false };
    } catch (error) {
        logger.error(`sample project for ${companyId} failed: ${error && error.message ? error.message : error}`);
        return { ok: false, error: error && error.message };
    }
};

/**
 * Adds the focus's ten teaching tasks to a freshly created project's default
 * sprint (Create Project → "Include the sample tasks").
 */
exports.seedSampleTasks = async ({ companyId, projectDoc, sprintDoc, uid, focus }) => {
    const userData = await loadUserData(uid, companyId);
    const statusByName = new Map((projectDoc.taskStatusData || []).map((s) => [String(s.name || '').toLowerCase(), { name: s.name, key: s.key, type: s.type }]));
    const taskTypeByKey = new Map((projectDoc.taskTypeCounts || []).map((t) => [String(t.key), t]));
    return withTimeout(
        orchestrator().createTasksForSprint({
            companyId,
            projectDoc,
            sprintDoc,
            tasks: sampleTasksFor(focus, uid),
            statusByName,
            taskTypeByKey,
            creatorUid: String(uid),
            userData,
        }),
        SEED_TIMEOUT_MS,
        'seedSampleTasks',
    );
};
