const logger = require('../../Config/loggerConfig');
const { tenantOf } = require('../../Config/tenant');
const rules = require('./rules');
const { readSource } = require('./structure');
const { planTasks, sourceRows } = require('./tasks');
const { liveProject, latestJob, buildProject } = require('./build');

const NOT_FOUND = 'Project not found.';
const PERSONAL = 'A personal list cannot be duplicated.';
const FAILED = 'The project could not be duplicated.';

const refuse = (res, code, statusText, extra = {}) => res.status(code).send({ status: false, statusText, message: statusText, ...extra });
const logged = (what) => (error) => logger.error(`duplicate project: ${what}: ${(error && error.message) || error}`);

/* POST /api/v2/projects/:id/duplicate { name, include: { tasks, assignees, dates } } */
exports.duplicate = async (req, res) => {
    let companyId;
    try {
        companyId = tenantOf(req);
    } catch (error) {
        return refuse(res, error.statusCode || 403, error.message);
    }
    const caller = String(req.uid || '');
    const sourceId = String(req.params.id || '');
    if (!rules.OBJECT_ID.test(sourceId) || !rules.OBJECT_ID.test(caller)) return refuse(res, 404, NOT_FOUND);
    const request = rules.parseRequest(req.body);
    if (!request.ok) return refuse(res, 400, request.statusText);

    try {
        const source = await liveProject(companyId, sourceId);
        if (!source) return refuse(res, 404, NOT_FOUND);
        if (source.isPersonal === true) return refuse(res, 400, PERSONAL);

        const { include, name } = request;
        const data = await buildProject({
            companyId, caller, name, include,
            bundle: await readSource({ companyId, caller, source }),
            planFor: (copy) => planTasks(companyId, sourceId, copy.sourceListIds),
            readRows: sourceRows(companyId, sourceId),
        });
        return res.send({ status: true, statusText: 'Project duplicated.', data });
    } catch (error) {
        logged('failed')(error);
        const missing = rules.refusedPaths(error);
        return missing.length ? refuse(res, 400, `${FAILED} The source project has no valid ${missing.join(', ')}.`) : refuse(res, 500, FAILED);
    }
};

/* GET /api/v2/projects/:id/duplicate, where :id is the copy: how far the tasks of a large copy have got. */
exports.progress = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const projectId = String(req.params.id || '');
        if (!rules.OBJECT_ID.test(projectId)) return refuse(res, 404, NOT_FOUND);
        return res.send({ status: true, statusText: 'Duplicate progress fetched.', data: await latestJob(companyId, projectId, String(req.uid || '')) });
    } catch (error) {
        logged('progress')(error);
        return refuse(res, error.statusCode || 500, error.statusCode ? error.message : FAILED);
    }
};
