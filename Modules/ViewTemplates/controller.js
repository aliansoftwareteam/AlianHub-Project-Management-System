const { SCHEMA_TYPE } = require('../../Config/schemaType');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { canEditProject, FIELD_PERMISSIONS } = require('../../Config/projectAccess');
const { namedCompanyIds } = require('../../Config/tenant');
const { cleanViewSettings, cleanViewTitle } = require('../Project/helpers/viewSettings');
const { VIEW_TYPES, MAX_TEMPLATES } = require('./templateRules');
const { OBJECT_ID, oid, crud, liveTemplate, liveTemplates, countTemplates } = require('./templateStore');

const SOCKET_MODULE = 'viewTemplates';
const NOT_FOUND = 'Template not found.';
const FORBIDDEN = 'You do not have permission to perform this action.';
const NO_COMPANY = 'You do not have access to this company.';

const refuse = (res, statusCode, statusText) => res.status(statusCode).json({ status: false, statusText, message: statusText });

const fail = (res, where, error) => {
    logger.error(`[viewTemplates] ${where}: ${error && error.message}`);
    return refuse(res, 500, 'Something went wrong with the view template.');
};

/* The one company the request names; a body or query naming a second one is refused rather than resolved. */
const companyOf = (req) => {
    const named = namedCompanyIds(req);
    return named.length === 1 && OBJECT_ID.test(named[0]) ? named[0] : '';
};

const present = (row, canManage) => ({ _id: String(row._id), name: row.name, viewType: row.viewType, canManage });

const announce = (type, companyId, row) => socketEmitter.emit(type, {
    type,
    companyId,
    data: { _id: String(row._id), name: row.name, viewType: row.viewType },
    module: SOCKET_MODULE,
});

const viewIdOf = (view) => String((view && (view._id || view.id)) || '');

const storedView = async (companyId, uid, projectId, viewId) => {
    const project = await crud(companyId, SCHEMA_TYPE.PROJECTS, [{ _id: oid(projectId) }, { ProjectRequiredComponent: 1 }], 'findOne');
    const shared = ((project && project.ProjectRequiredComponent) || []).find((view) => viewIdOf(view) === viewId);
    if (shared) return shared;
    const seat = await crud(companyId, SCHEMA_TYPE.COMPANY_USERS, [{ userId: String(uid) }, { ProjectRequiredComponent: 1 }], 'findOne');
    return ((seat && seat.ProjectRequiredComponent) || [])
        .find((view) => view && view.isPrivate === true && String(view.id) === viewId && String(view.projectId) === projectId) || null;
};

exports.listTemplates = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const roleType = companyId ? await getRoleType(companyId, req.uid) : null;
        if (roleType === null) return refuse(res, 403, NO_COMPANY);
        const canManage = isPrivileged(roleType);
        const data = (await liveTemplates(companyId))
            .map((row) => present(row, canManage))
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        return res.status(200).json({ status: true, data });
    } catch (error) {
        return fail(res, 'list', error);
    }
};

exports.saveTemplate = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return refuse(res, 403, NO_COMPANY);
        const { projectId, viewId, name } = req.body || {};
        const title = cleanViewTitle(name);
        if (!title) return refuse(res, 400, 'A template name is required.');
        if (!OBJECT_ID.test(String(projectId || ''))) return refuse(res, 400, 'A valid project id is required.');
        if (typeof viewId !== 'string' || !viewId) return refuse(res, 400, 'A view id is required.');

        const decision = await canEditProject(companyId, req.uid, projectId, [FIELD_PERMISSIONS.ProjectRequiredComponent]);
        if (!decision.allowed) return decision.statusCode === 404 ? refuse(res, 404, 'Project not found.') : refuse(res, 403, FORBIDDEN);

        const view = await storedView(companyId, req.uid, String(projectId), viewId);
        if (!view || !view.keyName) return refuse(res, 404, 'View not found.');
        if (!VIEW_TYPES.includes(view.keyName)) return refuse(res, 400, 'This kind of view keeps no setup to save.');
        if ((await countTemplates(companyId)) >= MAX_TEMPLATES) return refuse(res, 400, 'This workspace has as many view templates as it can hold.');

        const saved = await crud(companyId, SCHEMA_TYPE.VIEW_TEMPLATES, {
            name: title,
            viewType: view.keyName,
            settings: cleanViewSettings(view.settings),
            createdBy: String(req.uid),
            updatedBy: String(req.uid),
            deletedStatusKey: 0,
        }, 'save');
        announce('insert', companyId, saved);
        return res.status(200).json({ status: true, statusText: 'Template saved.', data: present(saved, isPrivileged(await getRoleType(companyId, req.uid))) });
    } catch (error) {
        return fail(res, 'save', error);
    }
};

/* Renaming and deleting are for owners and admins. */
const manageable = async (req) => {
    const companyId = companyOf(req);
    if (!companyId) return { refusal: [403, NO_COMPANY] };
    if (!isPrivileged(await getRoleType(companyId, req.uid))) return { refusal: [403, FORBIDDEN] };
    const template = await liveTemplate(companyId, req.params.id);
    return template ? { companyId, template } : { refusal: [404, NOT_FOUND] };
};

exports.renameTemplate = async (req, res) => {
    try {
        const name = cleanViewTitle((req.body || {}).name);
        if (!name) return refuse(res, 400, 'A template name is required.');
        const { refusal, companyId, template } = await manageable(req);
        if (refusal) return refuse(res, ...refusal);
        await crud(companyId, SCHEMA_TYPE.VIEW_TEMPLATES, [{ _id: oid(template._id) }, { $set: { name, updatedBy: String(req.uid) } }], 'updateOne');
        announce('update', companyId, { ...template, name });
        return res.status(200).json({ status: true, statusText: 'Template renamed.', data: present({ ...template, name }, true) });
    } catch (error) {
        return fail(res, 'rename', error);
    }
};

exports.deleteTemplate = async (req, res) => {
    try {
        const { refusal, companyId, template } = await manageable(req);
        if (refusal) return refuse(res, ...refusal);
        await crud(companyId, SCHEMA_TYPE.VIEW_TEMPLATES, [{ _id: oid(template._id) }, { $set: { deletedStatusKey: 1, updatedBy: String(req.uid) } }], 'updateOne');
        announce('delete', companyId, template);
        return res.status(200).json({ status: true, statusText: 'Template deleted.' });
    } catch (error) {
        return fail(res, 'delete', error);
    }
};
