const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../../utils/commonFunctions');
const socketEmitter = require('../../../event/socketEventEmitter');
const logger = require('../../../Config/loggerConfig');
const { isPlainObject, cleanViewSettings, cleanViewTitle } = require('../helpers/viewSettings');
const { liveTemplate, fitToProject, catalogueView } = require('../../ViewTemplates/templateStore');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const EMBED_ID_LENGTH = 6;
const MAX_VIEWS = 60;
const COPIED_FIELDS = ['keyName', 'name', 'value', 'icon', 'activeIcon', 'sortIndex'];

const refuse = (res, code, statusText) => res.status(code).json({ status: false, statusText, message: statusText });

const viewIdOf = (view) => String((view && (view._id || view.id)) || '');

const findProject = (companyId, projectId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECTS,
    data: [{ _id: new mongoose.Types.ObjectId(projectId) }, { ProjectRequiredComponent: 1, taskStatusData: 1 }],
}, 'findOne');

const announce = (companyId, project, updatedFields) => {
    removeCache('UserProjectData:', true);
    socketEmitter.emit('update', { type: 'update', companyId: String(companyId), data: project, updatedFields, module: 'project' });
};

const readRequest = async (req, res) => {
    const companyId = String(req.headers.companyid || '');
    const projectId = String(req.params.id || '');
    if (!OBJECT_ID.test(projectId)) {
        refuse(res, 400, 'A valid project id is required.');
        return null;
    }
    const project = await findProject(companyId, projectId);
    if (!project) {
        refuse(res, 404, 'Project not found.');
        return null;
    }
    return { companyId, projectId, project };
};

exports.saveViewSettings = async (req, res) => {
    try {
        const { viewId, settings } = req.body || {};
        if (typeof viewId !== 'string' || !viewId) return refuse(res, 400, 'A view id is required.');
        if (!isPlainObject(settings)) return refuse(res, 400, 'Settings must be an object.');
        const context = await readRequest(req, res);
        if (!context) return undefined;

        const view = (context.project.ProjectRequiredComponent || []).find((entry) => viewIdOf(entry) === viewId);
        if (!view) return refuse(res, 404, 'View not found.');

        const clean = cleanViewSettings(settings);
        const updated = await MongoDbCrudOpration(context.companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                { _id: new mongoose.Types.ObjectId(context.projectId) },
                { $set: { 'ProjectRequiredComponent.$[view].settings': clean } },
                { arrayFilters: [view._id !== undefined ? { 'view._id': view._id } : { 'view.id': view.id }], returnDocument: 'after' },
            ],
        }, 'findOneAndUpdate');
        if (!updated) return refuse(res, 404, 'Project not found.');

        announce(context.companyId, updated, { ProjectRequiredComponent: 'settings' });
        return res.status(200).json({ status: true, statusText: 'View saved.', data: { viewId, settings: clean } });
    } catch (error) {
        logger.error(`saveViewSettings: ${(error && error.message) || error}`);
        return refuse(res, 500, 'The view could not be saved.');
    }
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sameTitle = (title) => new RegExp(`^\\s*${title.trim().split(/\s+/).map(escapeRegex).join('\\s+')}\\s*$`, 'i');

const isCopyable = (view) => Boolean(view && view.keyName) && viewIdOf(view).length > EMBED_ID_LENGTH;

exports.isCopyable = isCopyable;

const copiedFrom = (source) => Object.fromEntries(COPIED_FIELDS.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));

const copyProblem = ({ sourceViewId, title, settings }) => {
    if (!cleanViewTitle(title)) return 'A view needs a name.';
    if (typeof sourceViewId !== 'string' || !sourceViewId) return 'A source view is required.';
    if (settings !== undefined && !isPlainObject(settings)) return 'Settings must be an object.';
    return '';
};

const planCopy = (views, body) => {
    const source = views.find((entry) => viewIdOf(entry) === body.sourceViewId);
    if (!isCopyable(source)) return { notFound: 'View not found.' };
    return { source, title: cleanViewTitle(body.title), settings: cleanViewSettings(body.settings), leftOut: [] };
};

/* A project that has no view of the template's kind yet gets the catalogue's own row, as the Add view menu would add it. */
const planFromTemplate = async ({ companyId, project }, views, body) => {
    const template = await liveTemplate(companyId, body.templateId);
    if (!template) return { notFound: 'Template not found.' };
    const existing = views.find((entry) => entry.keyName === template.viewType && isCopyable(entry));
    const source = existing || await catalogueView(companyId, template.viewType);
    if (!isCopyable(source)) return { notFound: 'View not found.' };
    const { settings, leftOut } = await fitToProject(companyId, project, template);
    return { source, isFirstOfKind: !existing, title: cleanViewTitle(body.title) || template.name, settings, leftOut };
};

exports.createView = async (req, res) => {
    try {
        const body = req.body || {};
        const fromTemplate = body.templateId !== undefined;
        const problem = fromTemplate ? '' : copyProblem(body);
        if (problem) return refuse(res, 400, problem);
        const context = await readRequest(req, res);
        if (!context) return undefined;

        const views = context.project.ProjectRequiredComponent || [];
        const plan = fromTemplate ? await planFromTemplate(context, views, body) : planCopy(views, body);
        if (plan.notFound) return refuse(res, 404, plan.notFound);
        const { source, title, settings, leftOut } = plan;

        /* A private view lives on the caller's member row, which only the private-view route writes. */
        if (fromTemplate && body.isPrivate === true) {
            return res.status(200).json({ status: true, statusText: 'View prepared.', data: { ...copiedFrom(source), _id: viewIdOf(source), title, settings }, leftOut });
        }
        if (views.length >= MAX_VIEWS) return refuse(res, 400, 'This project has as many views as it can hold.');

        const id = plan.isFirstOfKind ? viewIdOf(source) : new mongoose.Types.ObjectId().toString();
        const view = {
            ...copiedFrom(source),
            _id: id,
            id,
            title,
            ...(plan.isFirstOfKind ? {} : { sourceViewId: viewIdOf(source) }),
            settings,
            viewStatus: true,
            isPin: fromTemplate && body.isPin === true,
            setAsDefault: false,
            createdBy: String(req.uid || ''),
            createdAt: new Date(),
        };

        const unique = body.uniqueTitle === true;
        /* Checked in the write itself, so two approvals running at once cannot both add the name. */
        const notTaken = unique ? { $nor: [{ ProjectRequiredComponent: { $elemMatch: { title: sameTitle(title), isPrivate: { $ne: true }, viewStatus: { $ne: false } } } }] } : {};
        const updated = await MongoDbCrudOpration(context.companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                { _id: new mongoose.Types.ObjectId(context.projectId), ...notTaken },
                { $push: { ProjectRequiredComponent: view } },
                { returnDocument: 'after' },
            ],
        }, 'findOneAndUpdate');
        if (!updated && unique) return refuse(res, 409, 'A shared view by that name already exists.');
        if (!updated) return refuse(res, 404, 'Project not found.');

        announce(context.companyId, updated, { ProjectRequiredComponent: 'add' });
        return res.status(200).json({ status: true, statusText: 'View added.', data: view, leftOut });
    } catch (error) {
        logger.error(`createView: ${(error && error.message) || error}`);
        return refuse(res, 500, 'The view could not be added.');
    }
};
