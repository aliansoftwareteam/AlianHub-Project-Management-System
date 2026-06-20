const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const config = require('../../Config/config');
const R = require('./helpers/icalRules');

// AUTO-02 — calendar. Credential-free core: a tokenized, read-only .ics feed of
// task due-dates, subscribable in any calendar app. Feed config lives in the
// GLOBAL db (token-keyed) so the unauthenticated feed URL resolves its company.
// 2-way Google/Microsoft OAuth is the documented config-gated extension.

const GLOBAL = SCHEMA_TYPE.GOLBAL;
const SCOPES = ['my', 'project'];
const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const feedUrl = (req, token) => {
    const base = (config && config.WEBURL) ? String(config.WEBURL) : `${req.protocol}://${req.get('host')}`;
    return `${base.replace(/\/$/, '')}/api/v1/calendar/ics/${token}`;
};
const withUrl = (req) => (doc) => {
    if (!doc) return doc;
    const o = doc.toObject ? doc.toObject() : { ...doc };
    o.url = feedUrl(req, o.token);
    return o;
};

// POST /api/v1/calendar/feeds  { scope:'my'|'project', projectId?, name?, userData }
exports.createFeed = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const b = req.body || {};
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const scope = SCOPES.includes(b.scope) ? b.scope : 'my';
        const userId = String((b.userData && b.userData.id) || req.uid || '');
        if (scope === 'my' && !userId) return res.send({ status: false, statusText: 'A user is required for a personal feed.' });
        if (scope === 'project' && !oid(b.projectId)) return res.send({ status: false, statusText: 'A valid projectId is required for a project feed.' });
        const token = R.generateFeedToken();
        const doc = {
            _id: new mongoose.Types.ObjectId(), token, companyId: String(companyId), scope, userId,
            projectId: scope === 'project' ? String(b.projectId) : '',
            name: b.name || (scope === 'my' ? 'My tasks' : 'Project tasks'),
            enabled: true, createdBy: userId, deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(GLOBAL, { type: SCHEMA_TYPE.CALENDAR_FEEDS, data: doc }, 'save');
        removeCache(`calendar_feeds:${companyId}`);
        return res.send({ status: true, statusText: 'Feed created.', data: withUrl(req)(saved) });
    } catch (e) { logger.error(`createFeed: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// GET /api/v1/calendar/feeds — feeds in this company.
exports.listFeeds = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const rows = await MongoDbCrudOpration(GLOBAL, {
            type: SCHEMA_TYPE.CALENDAR_FEEDS, data: [{ companyId: String(companyId), deletedStatusKey: { $ne: 1 } }, {}, { sort: { createdAt: -1 } }],
        }, 'find');
        return res.send({ status: true, data: (rows || []).map(withUrl(req)) });
    } catch (e) { logger.error(`listFeeds: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// DELETE /api/v1/calendar/feeds/:id
exports.deleteFeed = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        await MongoDbCrudOpration(GLOBAL, {
            type: SCHEMA_TYPE.CALENDAR_FEEDS, data: [{ _id: oid(req.params.id), companyId: String(companyId) }, { $set: { deletedStatusKey: 1, enabled: false } }],
        }, 'updateOne');
        removeCache(`calendar_feeds:${companyId}`);
        return res.send({ status: true, statusText: 'Feed removed.' });
    } catch (e) { logger.error(`deleteFeed: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// GET /api/v1/calendar/ics/:token — PUBLIC read-only .ics feed of task due-dates.
exports.getIcs = async (req, res) => {
    try {
        const token = String(req.params.token || '').toLowerCase().replace(/\.ics$/, '');
        if (!R.isFeedToken(token)) return res.status(400).send('Invalid feed token.');
        const feed = await MongoDbCrudOpration(GLOBAL, { type: SCHEMA_TYPE.CALENDAR_FEEDS, data: [{ token }] }, 'findOne');
        if (!feed || feed.deletedStatusKey === 1 || feed.enabled === false) return res.status(404).send('Feed not found.');
        const match = { DueDate: { $ne: null }, deletedStatusKey: 0 };
        if (feed.scope === 'project' && oid(feed.projectId)) match.ProjectID = oid(feed.projectId);
        if (feed.scope === 'my' && feed.userId) match.AssigneeUserId = feed.userId; // array-contains
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
        res.setHeader('Content-Disposition', `inline; filename="alianhub-${token.slice(0, 8)}.ics"`);
        return res.send(ics);
    } catch (e) { logger.error(`getIcs: ${e.message}`); return res.status(500).send('Error generating calendar.'); }
};
