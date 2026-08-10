const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { validateWebhookInput, isObjectIdString, generateSecret, EVENT_TYPES } = require('./helpers/webhookRules');
const { invalidateCompanyCache } = require('./dispatcher');

// Outgoing-webhook management. The HMAC secret is generated server-side and
// returned ONCE on create; list/update responses always mask it.
//
// A webhook belongs to the person who made it, not to the company: it carries their
// Slack or Discord URL, and one member's integrations are not another's business. Every
// route below is scoped to the caller — hiding rows from the list alone would leave them
// editable, deletable and readable by id.

/**
 * Who is asking, from the JWT — never from the request body.
 *
 * createWebhook used to take the owner from `userData` off the body, which meant the
 * recorded owner was whatever the caller typed. With the list now filtered by owner, that
 * would have been a way to read someone else's integrations rather than merely to
 * mislabel one.
 */
const callerId = (req) => String((req && req.uid) || '');

/**
 * Match only what this caller owns.
 *
 * Rows with no owner stay visible to everyone. They are webhooks that predate ownership
 * being recorded, and hiding them would leave an ACTIVE integration nobody can see, edit
 * or delete while it keeps posting company data to whatever URL it holds. Visible and
 * removable beats invisible and running.
 */
const ownedBy = (uid) => ({
    $or: [
        { createdBy: uid },
        { createdBy: '' },
        { createdBy: null },
        { createdBy: { $exists: false } },
    ],
});

const maskHook = (hook) => ({
    _id: hook._id,
    name: hook.name,
    url: hook.url,
    events: hook.events,
    active: hook.active !== false,
    format: hook.format || 'json',
    createdBy: hook.createdBy || '',
    lastStatus: hook.lastStatus,
    lastDeliveredAt: hook.lastDeliveredAt,
    createdAt: hook.createdAt,
});

/* GET /api/v2/webhooks/events — the subscribable event catalogue. */
exports.listEvents = (req, res) => {
    return res.send({ status: true, statusText: 'Webhook events.', data: EVENT_TYPES });
};

/* POST /api/v2/webhooks  body: { name, url, events, format } */
exports.createWebhook = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { name, url, events, format } = req.body || {};
        const uid = callerId(req);
        if (!companyId) {
            return res.send({ status: false, statusText: 'companyId is required.' });
        }
        if (!uid) {
            return res.send({ status: false, statusText: 'An authenticated user is required.' });
        }
        const check = validateWebhookInput({ name, url, events, format });
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
                format: format || 'json',
                createdBy: uid,
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
            data: [ownedBy(callerId(req))],
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
        const { name, url, events, active, format } = req.body || {};
        const update = {};
        if (name !== undefined || url !== undefined || events !== undefined || format !== undefined) {
            const check = validateWebhookInput({
                name: name !== undefined ? name : 'placeholder',
                url: url !== undefined ? url : 'https://placeholder.invalid',
                events: events !== undefined ? events : ['*'],
                format,
            });
            if (!check.valid) {
                return res.send({ status: false, statusText: check.reason });
            }
            if (name !== undefined) update.name = String(name).trim();
            if (url !== undefined) update.url = String(url).trim();
            if (events !== undefined) update.events = events;
            if (format !== undefined) update.format = format;
        }
        if (active !== undefined) update.active = active === true;
        if (!Object.keys(update).length) {
            return res.send({ status: false, statusText: 'Nothing to update.' });
        }

        // Ownership is part of the MATCH, not a check after the fact: someone else's
        // webhook is simply not found, which is also the answer that tells a prober
        // nothing about whether the id exists.
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.WEBHOOKS,
            data: [
                { _id: new mongoose.Types.ObjectId(id), ...ownedBy(callerId(req)) },
                { $set: update },
                { returnDocument: 'after' },
            ],
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
        // Confirm it is the caller's BEFORE deleting anything — a plain deleteOne on the id
        // would let one member remove another's integration, and the logs with it.
        const owned = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.WEBHOOKS,
            data: [{ _id: webhookId, ...ownedBy(callerId(req)) }],
        }, 'findOne');
        if (!owned) {
            return res.send({ status: false, statusText: 'Webhook not found.' });
        }
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

/**
 * GET /api/v2/webhooks/:id/logs?skip=&limit= — newest deliveries, a page at a time.
 *
 * A busy webhook accumulates a row per delivery and this used to return 50 in one go for
 * a panel that shows a handful. Paged at 10 by default, capped at 50 so a caller cannot
 * ask for the whole table back.
 */
exports.listWebhookLogs = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid webhook id are required.' });
        }
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
        const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
        // Delivery logs carry the destination's responses, so they are as private as the
        // webhook itself — check ownership before reading them.
        const webhookId = new mongoose.Types.ObjectId(id);
        const owned = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.WEBHOOKS,
            data: [{ _id: webhookId, ...ownedBy(callerId(req)) }],
        }, 'findOne');
        if (!owned) {
            return res.send({ status: false, statusText: 'Webhook not found.' });
        }
        // One row past the page is read but never returned: that is what makes hasMore
        // exact. Asking for exactly the page cannot tell "there are more" from "that was
        // the last one", which leaves a Load more button that does nothing when clicked.
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.WEBHOOK_LOGS,
            data: [{ webhookId }, null, { sort: { createdAt: -1 }, skip, limit: limit + 1 }],
        }, 'find');
        const page = (rows || []).slice(0, limit);
        return res.send({
            status: true,
            statusText: 'Delivery log fetched.',
            data: page,
            hasMore: (rows || []).length > limit,
            nextSkip: skip + page.length,
        });
    } catch (error) {
        logger.error(`ERROR in list webhook logs: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
