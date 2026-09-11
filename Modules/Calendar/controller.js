const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const { tenantOf } = require('../../Config/tenant');
const logger = require('../../Config/loggerConfig');
const config = require('../../Config/config');
const { visibleProjectIds } = require('../Agents/scope');
const R = require('./helpers/icalRules');

const GLOBAL = SCHEMA_TYPE.GOLBAL;
const FEEDS = SCHEMA_TYPE.CALENDAR_FEEDS;
const SCOPES = ['my', 'project'];
const NAME_MAX_LENGTH = 120;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const FEED_NOT_FOUND = 'Feed not found.';

const oid = (id) => (OBJECT_ID.test(String(id || '')) ? new mongoose.Types.ObjectId(String(id)) : null);
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const reject = (res, statusCode, statusText) => res.status(statusCode).json({ status: false, statusText, message: statusText });

const fail = (res, where, error) => {
    if (error && error.name === 'TenantError') return reject(res, error.statusCode, error.message);
    logger.error(`${where}: ${error && error.message}`);
    return reject(res, 500, 'The calendar feed request could not be completed.');
};

const callerOf = (req) => String(req.uid || '');

const feedUrl = (req, token) => {
    const base = (config && config.WEBURL) ? String(config.WEBURL) : `${req.protocol}://${req.get('host')}`;
    return `${base.replace(/\/$/, '')}/api/v1/calendar/ics/${token}`;
};

const describeFeed = (doc) => {
    const { _id, name, scope, projectId, userId, enabled, createdAt, updatedAt } = plain(doc);
    return { _id, name, scope, projectId, userId, enabled, createdAt, updatedAt };
};

const withLink = (req, doc, token) => ({ ...describeFeed(doc), token, url: feedUrl(req, token) });

const ownFeed = (companyId, userId, id) => ({ _id: oid(id), companyId: String(companyId), userId, deletedStatusKey: { $ne: 1 } });

const clearFeedCache = (companyId) => removeCache(`calendar_feeds:${companyId}`);

exports.createFeed = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const userId = callerOf(req);
        const body = req.body || {};
        if (!userId) return reject(res, 401, 'Sign in to manage calendar feeds.');
        const scope = SCOPES.includes(body.scope) ? body.scope : 'my';
        if (body.name !== undefined && body.name !== null && (typeof body.name !== 'string' || body.name.trim().length > NAME_MAX_LENGTH)) {
            return reject(res, 400, `A feed name must be text of at most ${NAME_MAX_LENGTH} characters.`);
        }
        if (scope === 'project') {
            if (!oid(body.projectId)) return reject(res, 400, 'A valid projectId is required for a project feed.');
            const visible = await visibleProjectIds(companyId, userId);
            if (!visible.includes(String(body.projectId))) return reject(res, 404, 'Project not found.');
        }
        const token = R.generateFeedToken();
        const saved = await MongoDbCrudOpration(GLOBAL, {
            type: FEEDS,
            data: {
                _id: new mongoose.Types.ObjectId(),
                tokenHash: R.hashFeedToken(token),
                companyId,
                scope,
                userId,
                projectId: scope === 'project' ? String(body.projectId) : '',
                name: (typeof body.name === 'string' && body.name.trim()) || (scope === 'my' ? 'My tasks' : 'Project tasks'),
                enabled: true,
                createdBy: userId,
                deletedStatusKey: 0,
            },
        }, 'save');
        clearFeedCache(companyId);
        return res.status(200).json({ status: true, statusText: 'Feed created.', data: withLink(req, saved, token) });
    } catch (error) {
        return fail(res, 'createFeed', error);
    }
};

exports.listFeeds = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const userId = callerOf(req);
        if (!userId) return reject(res, 401, 'Sign in to manage calendar feeds.');
        const rows = await MongoDbCrudOpration(GLOBAL, {
            type: FEEDS,
            data: [{ companyId, userId, deletedStatusKey: { $ne: 1 } }, { token: 0, tokenHash: 0 }, { sort: { createdAt: -1 } }],
        }, 'find');
        return res.status(200).json({ status: true, statusText: 'Feeds loaded.', data: (rows || []).map(describeFeed) });
    } catch (error) {
        return fail(res, 'listFeeds', error);
    }
};

exports.regenerateFeed = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const userId = callerOf(req);
        if (!userId) return reject(res, 401, 'Sign in to manage calendar feeds.');
        if (!oid(req.params.id)) return reject(res, 400, 'A valid feed id is required.');
        const token = R.generateFeedToken();
        const updated = await MongoDbCrudOpration(GLOBAL, {
            type: FEEDS,
            data: [ownFeed(companyId, userId, req.params.id), { $set: { tokenHash: R.hashFeedToken(token) }, $unset: { token: '' } }, { new: true }],
        }, 'findOneAndUpdate');
        if (!updated) return reject(res, 404, FEED_NOT_FOUND);
        clearFeedCache(companyId);
        return res.status(200).json({ status: true, statusText: 'Feed link regenerated.', data: withLink(req, updated, token) });
    } catch (error) {
        return fail(res, 'regenerateFeed', error);
    }
};

exports.deleteFeed = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const userId = callerOf(req);
        if (!userId) return reject(res, 401, 'Sign in to manage calendar feeds.');
        if (!oid(req.params.id)) return reject(res, 400, 'A valid feed id is required.');
        const result = await MongoDbCrudOpration(GLOBAL, {
            type: FEEDS,
            data: [ownFeed(companyId, userId, req.params.id), { $set: { deletedStatusKey: 1, enabled: false }, $unset: { token: '', tokenHash: '' } }],
        }, 'updateOne');
        if (!result || !(result.matchedCount || result.modifiedCount)) return reject(res, 404, FEED_NOT_FOUND);
        clearFeedCache(companyId);
        return res.status(200).json({ status: true, statusText: 'Feed removed.' });
    } catch (error) {
        return fail(res, 'deleteFeed', error);
    }
};

/* The token only proves which feed was asked for. What it may show is decided now, from the
 * owner's current membership and project visibility, so a removed member or a lost project
 * stops leaking through a link that was handed out earlier. */
const readableProjectIds = async (feed) => {
    if (!feed.userId || !OBJECT_ID.test(String(feed.companyId || ''))) return null;
    const member = await MongoDbCrudOpration(feed.companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId: String(feed.userId), isDelete: { $ne: true }, status: { $nin: [3] } }, { _id: 1 }],
    }, 'findOne');
    if (!member) return null;
    const visible = await visibleProjectIds(feed.companyId, feed.userId);
    if (feed.scope === 'project') return visible.includes(String(feed.projectId)) ? [String(feed.projectId)] : null;
    return visible;
};

exports.getIcs = async (req, res) => {
    try {
        const token = String(req.params.token || '').toLowerCase().replace(/\.ics$/, '');
        if (!R.isFeedToken(token)) return res.status(400).send('Invalid feed token.');
        const feed = await MongoDbCrudOpration(GLOBAL, {
            type: FEEDS,
            data: [{ tokenHash: R.hashFeedToken(token), deletedStatusKey: { $ne: 1 }, enabled: { $ne: false } }],
        }, 'findOne');
        const projectIds = feed ? await readableProjectIds(feed) : null;
        if (!projectIds) return res.status(404).send(FEED_NOT_FOUND);
        const match = { DueDate: { $ne: null }, deletedStatusKey: 0, ProjectID: { $in: projectIds.map(oid).filter(Boolean) } };
        if (feed.scope === 'my') match.AssigneeUserId = { $in: [String(feed.userId)] };
        const tasks = await MongoDbCrudOpration(feed.companyId, {
            type: SCHEMA_TYPE.TASKS, data: [match, 'TaskName TaskKey DueDate ProjectID statusType', { limit: 1000 }],
        }, 'find');
        const events = (tasks || []).filter((t) => t.DueDate).map((t) => ({
            uid: String(t._id),
            summary: `${t.TaskKey ? `[${t.TaskKey}] ` : ''}${t.TaskName || 'Task'}`,
            date: t.DueDate,
            description: t.statusType === 'close' ? 'Status: done' : '',
        }));
        const ics = R.buildIcs({ calName: feed.name || 'AlianHub', events, stamp: R.fmtStamp(new Date()) });
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `inline; filename="alianhub-${String(feed._id)}.ics"`);
        return res.send(ics);
    } catch (error) {
        logger.error(`getIcs: ${error && error.message}`);
        return res.status(500).send('Error generating calendar.');
    }
};
