const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../../utils/commonFunctions');
const socketEmitter = require('../../../event/socketEventEmitter');
const logger = require('../../../Config/loggerConfig');
const { isPlainObject, cleanViewSettings, cleanViewTitle } = require('../helpers/viewSettings');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const EMBED_ID_LENGTH = 6;
const MAX_VIEWS = 60;
const COPIED_FIELDS = ['keyName', 'name', 'value', 'icon', 'activeIcon', 'sortIndex'];

const refuse = (res, code, statusText) => res.status(code).json({ status: false, statusText, message: statusText });

const viewIdOf = (view) => String((view && (view._id || view.id)) || '');

const findProject = (companyId, projectId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECTS,
    data: [{ _id: new mongoose.Types.ObjectId(projectId) }, { ProjectRequiredComponent: 1 }],
}, 'findOne');

const announce = (project, updatedFields) => {
    removeCache('UserProjectData:', true);
    socketEmitter.emit('update', { type: 'update', data: project, updatedFields, module: 'project' });
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

        announce(updated, { ProjectRequiredComponent: 'settings' });
        return res.status(200).json({ status: true, statusText: 'View saved.', data: { viewId, settings: clean } });
    } catch (error) {
        logger.error(`saveViewSettings: ${(error && error.message) || error}`);
        return refuse(res, 500, 'The view could not be saved.');
    }
};

exports.createView = async (req, res) => {
    try {
        const { sourceViewId, title, settings } = req.body || {};
        const name = cleanViewTitle(title);
        if (!name) return refuse(res, 400, 'A view needs a name.');
        if (typeof sourceViewId !== 'string' || !sourceViewId) return refuse(res, 400, 'A source view is required.');
        if (settings !== undefined && !isPlainObject(settings)) return refuse(res, 400, 'Settings must be an object.');
        const context = await readRequest(req, res);
        if (!context) return undefined;

        const views = context.project.ProjectRequiredComponent || [];
        const source = views.find((entry) => viewIdOf(entry) === sourceViewId);
        if (!source || !source.keyName || viewIdOf(source).length <= EMBED_ID_LENGTH) return refuse(res, 404, 'View not found.');
        if (views.length >= MAX_VIEWS) return refuse(res, 400, 'This project has as many views as it can hold.');

        const id = new mongoose.Types.ObjectId().toString();
        const view = {
            ...Object.fromEntries(COPIED_FIELDS.filter((field) => source[field] !== undefined).map((field) => [field, source[field]])),
            _id: id,
            id,
            title: name,
            sourceViewId: viewIdOf(source),
            settings: cleanViewSettings(settings),
            viewStatus: true,
            isPin: false,
            setAsDefault: false,
            createdBy: String(req.uid || ''),
            createdAt: new Date(),
        };

        const updated = await MongoDbCrudOpration(context.companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                { _id: new mongoose.Types.ObjectId(context.projectId) },
                { $push: { ProjectRequiredComponent: view } },
                { returnDocument: 'after' },
            ],
        }, 'findOneAndUpdate');
        if (!updated) return refuse(res, 404, 'Project not found.');

        announce(updated, { ProjectRequiredComponent: 'add' });
        return res.status(200).json({ status: true, statusText: 'View added.', data: view });
    } catch (error) {
        logger.error(`createView: ${(error && error.message) || error}`);
        return refuse(res, 500, 'The view could not be added.');
    }
};
