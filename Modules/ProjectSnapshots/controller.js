const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { tenantOf } = require('../../Config/tenant');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { OBJECT_ID } = require('../ProjectDuplicate/rules');
const { readSource } = require('../ProjectDuplicate/structure');
const { planOf, planTasks } = require('../ProjectDuplicate/tasks');
const { liveProject, buildProject } = require('../ProjectDuplicate/build');
const rules = require('./rules');
const store = require('./store');
const { freeze } = require('./freeze');
const { thaw } = require('./thaw');

const SOCKET_MODULE = 'projectSnapshots';
const PROJECT_NOT_FOUND = 'Project not found.';
const NOT_FOUND = 'Template not found.';
const FORBIDDEN = 'You do not have permission to perform this action.';
const PERSONAL = 'A personal list cannot be saved as a template.';
const FULL = `This workspace has as many project templates as it can hold (${rules.MAX_TEMPLATES}). Delete one to save another.`;
const KEY_TAKEN = 'That project key is already taken.';
const FAILED = 'Something went wrong with the project template.';

const refuse = (res, code, statusText) => res.status(code).send({ status: false, statusText, message: statusText });
const tooManyTasks = (count) => `A template holds at most ${rules.MAX_TASKS.toLocaleString('en-US')} tasks and this project has ${count.toLocaleString('en-US')}. Save it without its tasks.`;

const announce = (type, companyId, id) => socketEmitter.emit(type, { type, companyId, data: { _id: String(id) }, module: SOCKET_MODULE });

/* Runs `handle` with the company and the caller of the request; whatever it throws is logged and answered as a 500. */
const handler = (what, handle) => async (req, res) => {
    let companyId;
    try {
        companyId = tenantOf(req);
    } catch (error) {
        return refuse(res, error.statusCode || 403, error.message);
    }
    const caller = String(req.uid || '');
    if (!OBJECT_ID.test(caller)) return refuse(res, 404, NOT_FOUND);
    try {
        return await handle({ req, res, companyId, caller });
    } catch (error) {
        logger.error(`project template: ${what}: ${(error && error.message) || error}`);
        return refuse(res, 500, FAILED);
    }
};

const privilegedIn = async (companyId, caller) => isPrivileged(await getRoleType(companyId, caller));

/* A template the caller is not offered answers as one that is not there. */
const offered = async (companyId, caller, id) => {
    const template = await store.liveTemplate(companyId, id);
    const privileged = await privilegedIn(companyId, caller);
    return template && rules.canSee(template, caller, privileged) ? { template, privileged } : {};
};

/* POST /api/v2/projects/:id/template { name, description?, everyone?, include: { tasks, assignees, dates, automations } } */
exports.save = handler('save', async ({ req, res, companyId, caller }) => {
    const sourceId = String(req.params.id || '');
    if (!OBJECT_ID.test(sourceId)) return refuse(res, 404, PROJECT_NOT_FOUND);
    const request = rules.parseSave(req.body);
    if (!request.ok) return refuse(res, 400, request.statusText);

    const source = await liveProject(companyId, sourceId);
    if (!source) return refuse(res, 404, PROJECT_NOT_FOUND);
    if (source.isPersonal === true) return refuse(res, 400, PERSONAL);
    if ((await store.countTemplates(companyId)) >= rules.MAX_TEMPLATES) return refuse(res, 400, FULL);

    const bundle = await readSource({ companyId, caller, source, ownersSeeAll: false });
    const plan = request.include.tasks ? await planTasks(companyId, sourceId, bundle.lists.map((list) => list._id)) : planOf([]);
    if (plan.total > rules.MAX_TASKS) return refuse(res, 400, tooManyTasks(plan.total));

    const { template, notes } = await freeze({ companyId, caller, source, bundle, plan, request });
    announce('insert', companyId, template._id);
    return res.send({ status: true, statusText: 'Template saved.', data: { template: rules.presented(template, caller, await privilegedIn(companyId, caller)), notes } });
});

/* GET /api/v2/projects/templates */
exports.list = handler('list', async ({ res, companyId, caller }) => {
    const privileged = await privilegedIn(companyId, caller);
    const data = (await store.liveTemplates(companyId))
        .filter((template) => rules.canSee(template, caller, privileged))
        .map((template) => rules.presented(template, caller, privileged))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return res.send({ status: true, statusText: 'Templates fetched.', data });
});

/* POST /api/v2/projects/templates/:id/use { name, code?, isPrivate?, startDate?, include: { tasks, assignees, dates, automations } } */
exports.use = handler('use', async ({ req, res, companyId, caller }) => {
    const request = rules.parseUse(req.body);
    if (!request.ok) return refuse(res, 400, request.statusText);
    const { template } = await offered(companyId, caller, req.params.id);
    if (!template) return refuse(res, 404, NOT_FOUND);
    if (request.code && await store.codeTaken(companyId, request.code)) return refuse(res, 400, KEY_TAKEN);

    const { bundle, include, planFor, readRows } = await thaw({ companyId, caller, template, request });
    const data = await buildProject({ companyId, caller, bundle, name: request.name, code: request.code, include, planFor, readRows });
    return res.send({ status: true, statusText: 'Project created from the template.', data });
});

/* Changing and deleting a template are for the person who saved it, owners and admins. */
const managed = async ({ req, res, companyId, caller }) => {
    const { template, privileged } = await offered(companyId, caller, req.params.id);
    if (template && rules.canManage(template, caller, privileged)) return { template, privileged };
    refuse(res, template ? 403 : 404, template ? FORBIDDEN : NOT_FOUND);
    return null;
};

/* PATCH /api/v2/projects/templates/:id { name?, description?, everyone? } */
exports.edit = handler('edit', async (context) => {
    const { req, res, companyId, caller } = context;
    const request = rules.parseEdit(req.body);
    if (!request.ok) return refuse(res, 400, request.statusText);
    const found = await managed(context);
    if (!found) return undefined;
    await store.updateTemplate(companyId, found.template._id, { ...request.changes, updatedBy: caller });
    announce('update', companyId, found.template._id);
    return res.send({ status: true, statusText: 'Template updated.', data: rules.presented({ ...found.template, ...request.changes }, caller, found.privileged) });
});

/* DELETE /api/v2/projects/templates/:id */
exports.remove = handler('delete', async (context) => {
    const { res, companyId, caller } = context;
    const found = await managed(context);
    if (!found) return undefined;
    await store.updateTemplate(companyId, found.template._id, { deletedStatusKey: 1, updatedBy: caller });
    announce('delete', companyId, found.template._id);
    return res.send({ status: true, statusText: 'Template deleted.' });
});
