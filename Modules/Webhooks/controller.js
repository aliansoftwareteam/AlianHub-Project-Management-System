const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { validateWebhookInput, isObjectIdString, generateSecret, EVENT_TYPES } = require('./helpers/webhookRules');
const { invalidateCompanyCache } = require('./dispatcher');

// Outgoing-webhook management. The HMAC secret is generated server-side and
// returned ONCE on create; list/update responses always mask it.

const maskHook = (hook) => ({
    _id: hook._id,
    name: hook.name,
    url: hook.url,
    events: hook.events,
    active: hook.active !== false,
    createdBy: hook.createdBy || '',
    lastStatus: hook.lastStatus,
    lastDeliveredAt: hook.lastDeliveredAt,
    createdAt: hook.createdAt,
});

/* GET /api/v2/webhooks/events — the subscribable event catalogue. */
exports.listEvents = (req, res) => {
    return res.send({ status: true, statusText: 'Webhook events.', data: EVENT_TYPES });
};

/* POST /api/v2/webhooks  body: { name, url, events, userData } */
exports.createWebhook = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { name, url, events, userData } = req.body || {};
        if (!companyId) {
            return res.send({ status: false, statusText: 'companyId is required.' });
        }
        const check = validateWebhookInput({ name, url, events });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }

        const secret = generateSecret();
        const created = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.WEBHOOKS,
            data: {
                name: String(name).trim(),
                url: String(url).trim(),
                events,
                secret,
                active: true,
                createdBy: userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '',
            },
        }, 'save');

        invalidateCompanyCache(companyId);
        // The only time the secret is ever returned.
        return res.send({ status: true, statusText: 'Webhook created. Store the secret now — it is not shown again.', data: { ...maskHook(created), secret } });
    } catch (error) {
        logger.error(`ERROR in create webhook: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/webhooks */
exports.listWebhooks = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        if (!companyId) {
            return res.send({ status: false, statusText: 'companyId is required.' });
        }
        const hooks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.WEBHOOKS,
            data: [{}],
        }, 'find');
        return res.send({ status: true, statusText: 'Webhooks fetched.', data: (hooks || []).map(maskHook) });
    } catch (error) {
        logger.error(`ERROR in list webhooks: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* PUT /api/v2/webhooks/:id  body: { name?, url?, events?, active? } */
exports.updateWebhook = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid webhook id are required.' });
        }
        const { name, url, events, active } = req.body || {};
        const update = {};
        if (name !== undefined || url !== undefined || events !== undefined) {
            const check = validateWebhookInput({
                name: name !== undefined ? name : 'placeholder',
                url: url !== undefined ? url : 'https://placeholder.invalid',
                events: events !== undefined ? events : ['*'],
            });
            if (!check.valid) {
                return res.send({ status: false, statusText: check.reason });
            }
            if (name !== undefined) update.name = String(name).trim();
            if (url !== undefined) update.url = String(url).trim();
            if (events !== undefined) update.events = events;
        }
        if (active !== undefined) update.active = active === true;
        if (!Object.keys(update).length) {
            return res.send({ status: false, statusText: 'Nothing to update.' });
        }

        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.WEBHOOKS,
            data: [{ _id: new mongoose.Types.ObjectId(id) }, { $set: update }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) {
            return res.send({ status: false, statusText: 'Webhook not found.' });
        }
        invalidateCompanyCache(companyId);
        return res.send({ status: true, statusText: 'Webhook updated.', data: maskHook(updated) });
    } catch (error) {
        logger.error(`ERROR in update webhook: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* DELETE /api/v2/webhooks/:id */
exports.deleteWebhook = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid webhook id are required.' });
        }
        const webhookId = new mongoose.Types.ObjectId(id);
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.WEBHOOKS,
            data: [{ _id: webhookId }],
        }, 'deleteOne');
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.WEBHOOK_LOGS,
            data: [{ webhookId }],
        }, 'deleteMany').catch(() => {});
        invalidateCompanyCache(companyId);
        return res.send({ status: true, statusText: 'Webhook deleted.' });
    } catch (error) {
        logger.error(`ERROR in delete webhook: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/webhooks/:id/logs — newest 50 deliveries. */
exports.listWebhookLogs = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid webhook id are required.' });
        }
        const logs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.WEBHOOK_LOGS,
            data: [{ webhookId: new mongoose.Types.ObjectId(id) }, null, { sort: { createdAt: -1 }, limit: 50 }],
        }, 'find');
        return res.send({ status: true, statusText: 'Delivery log fetched.', data: logs || [] });
    } catch (error) {
        logger.error(`ERROR in list webhook logs: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
