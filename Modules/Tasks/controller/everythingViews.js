const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { tenantOf, TenantError } = require('../../../Config/tenant');
const { ACTIVE_SEAT } = require('../../../Config/seatStatus');
const logger = require('../../../Config/loggerConfig');
const { EverythingRefused } = require('../helpers/everythingQuery');
const { MAX_VIEWS, parseViewBody } = require('../helpers/everythingViews');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const LIVE = { deletedStatusKey: 0 };
const NOT_FOUND = 'View not found.';

const refuse = (res, statusCode, statusText, message, extra = {}) => res.status(statusCode).json({ status: false, statusText, message, ...extra });
const crud = (companyId, data, method) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.EVERYTHING_VIEWS, data }, method);

const present = (view) => ({
    _id: String(view._id),
    name: view.name,
    settings: view.settings || {},
    isDefault: view.isDefault === true,
    updatedAt: view.updatedAt || null,
});

/* A view belongs to the person who made it and to nobody else, whatever their role: every read
 * and write below names the caller's own id, so there is no id another person can pass to reach
 * it. Nothing is announced on the company's socket room for the same reason. */
const mine = (uid) => ({ userId: uid, ...LIVE });
const myView = (companyId, uid, id) => (OBJECT_ID.test(String(id || ''))
    ? crud(companyId, [{ _id: new mongoose.Types.ObjectId(String(id)), ...mine(uid) }, null, { lean: true }], 'findOne')
    : Promise.resolve(null));

/* The company and the person, once the person holds an active seat there; otherwise the refusal is sent. */
const callerOf = async (req, res) => {
    const companyId = tenantOf(req);
    const uid = String(req.uid || '');
    if (!uid) {
        refuse(res, 401, 'Unauthorized', 'Sign in to use saved views.');
        return null;
    }
    const seat = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId: uid, ...ACTIVE_SEAT }, { _id: 1 }],
    }, 'findOne');
    if (!seat) {
        refuse(res, 403, 'Forbidden', 'An active seat in this company is required.');
        return null;
    }
    return { companyId, uid };
};

const handled = (where, handler) => async (req, res) => {
    try {
        const caller = await callerOf(req, res);
        if (!caller) return undefined;
        return await handler(req, res, caller);
    } catch (error) {
        if (error instanceof EverythingRefused) return refuse(res, 400, 'Request refused', error.message, { field: error.field });
        if (error instanceof TenantError) return refuse(res, error.statusCode, 'Forbidden', error.message);
        logger.error(`everything views ${where}: ${error.message || error}`);
        return refuse(res, 500, 'Something went wrong with the saved view.', 'Something went wrong with the saved view.');
    }
};

const onlyDefault = (companyId, uid, id) => crud(companyId, [
    { ...mine(uid), isDefault: true, _id: { $ne: new mongoose.Types.ObjectId(String(id)) } },
    { $set: { isDefault: false } },
], 'updateMany');

exports.listViews = handled('list', async (req, res, { companyId, uid }) => {
    const views = await crud(companyId, [mine(uid), null, { lean: true }], 'find') || [];
    const data = views.map(present).sort((a, b) => a.name.localeCompare(b.name));
    return res.status(200).json({ status: true, statusText: 'Views fetched successfully.', data });
});

exports.createView = handled('create', async (req, res, { companyId, uid }) => {
    const fields = parseViewBody(req.body, ['name', 'settings']);
    if (Number(await crud(companyId, [mine(uid)], 'countDocuments')) >= MAX_VIEWS) {
        return refuse(res, 400, 'Request refused', `A person can keep at most ${MAX_VIEWS} views.`, { field: 'name' });
    }
    const saved = await crud(companyId, { userId: uid, isDefault: false, ...fields, ...LIVE }, 'save');
    if (fields.isDefault) await onlyDefault(companyId, uid, saved._id);
    return res.status(200).json({ status: true, statusText: 'View saved.', data: present(saved) });
});

exports.updateView = handled('update', async (req, res, { companyId, uid }) => {
    const fields = parseViewBody(req.body);
    const view = await myView(companyId, uid, req.params.id);
    if (!view) return refuse(res, 404, NOT_FOUND, NOT_FOUND);
    await crud(companyId, [{ _id: view._id, ...mine(uid) }, { $set: fields }], 'updateOne');
    if (fields.isDefault) await onlyDefault(companyId, uid, view._id);
    return res.status(200).json({ status: true, statusText: 'View saved.', data: present({ ...view, ...fields, updatedAt: new Date() }) });
});

exports.deleteView = handled('delete', async (req, res, { companyId, uid }) => {
    const view = await myView(companyId, uid, req.params.id);
    if (!view) return refuse(res, 404, NOT_FOUND, NOT_FOUND);
    await crud(companyId, [{ _id: view._id, ...mine(uid) }, { $set: { deletedStatusKey: 1, isDefault: false } }], 'updateOne');
    return res.status(200).json({ status: true, statusText: 'View deleted.' });
});
