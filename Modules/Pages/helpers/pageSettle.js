'use strict';

const { AsyncResource } = require('async_hooks');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const { emitPageChange } = require('./pageEvents');
const { contentToEditorData } = require('./pageContent');
const { userMentionIds } = require('./pageMentions');
const { notifyMentioned } = require('./pageMentionNotices');

/* An autosave writes the doc and nothing else. What a save used to set off on every call waits until the doc has
 * been left alone: the people it names are told after MENTION_QUIET_MS, and the doc is announced (which is what the
 * knowledge index syncs from, embeddings included) after INDEX_QUIET_MS. A save that is not an autosave settles
 * both at once. The timers live in this process: after a restart the next settled save of the doc catches up. */
const MENTION_QUIET_MS = 30 * 1000;
const INDEX_QUIET_MS = 60 * 1000;

const waiting = new Map();

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const keyOf = (companyId, pageId) => `${companyId}:${pageId}`;
const pages = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.PAGES, data }, method);
const logged = (what) => (error) => logger.error(`ERROR ${what}: ${error.message}`);

const namedIn = (content) => userMentionIds(contentToEditorData(content));

/* A doc saved before the list existed told everyone it names under the old rule, at the save that added them. */
const toldOf = (page) => (Array.isArray(page && page.mentionsTold) ? page.mentionsTold.map(String) : namedIn(page && page.content));

const untoldIn = (page, content = page.content) => {
    const told = new Set(toldOf(page));
    return namedIn(content).filter((id) => !told.has(id));
};

const tell = (companyId, page, actorId, named) => notifyMentioned({ companyId, page, actorId, named, content: contentToEditorData(page.content) })
    .catch(logged('in doc mention notices'));

/* Recorded before anyone is told, so a second pass over the same doc finds nobody left. */
const tellUntold = async (companyId, page, actorId) => {
    const untold = untoldIn(page);
    if (!untold.length) return;
    await pages(companyId, [{ _id: oid(page._id) }, { $set: { mentionsTold: [...toldOf(page), ...untold] } }], 'updateOne');
    await tell(companyId, page, actorId, untold);
};

const livePage = (companyId, pageId) => pages(companyId, [{ _id: oid(pageId), deletedStatusKey: 0 }], 'findOne');

const cancel = (companyId, pageId) => {
    const key = keyOf(companyId, pageId);
    const timers = waiting.get(key);
    if (!timers) return false;
    timers.forEach(clearTimeout);
    waiting.delete(key);
    return true;
};

/* What waits for a doc to be left alone is told for its last editor, long after the save that started the wait: bound
 * here, where no request is running, it runs under no token's project list, no agent's mark and no request. */
const runOutsideAnyRequest = AsyncResource.bind((what, run) => run().catch(logged(what)));

const after = (ms, what, run) => {
    const timer = setTimeout(() => runOutsideAnyRequest(what, run), ms);
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
};

const settleLater = (companyId, pageId) => {
    cancel(companyId, pageId);
    const key = keyOf(companyId, pageId);
    waiting.set(key, [
        after(MENTION_QUIET_MS, 'settling doc mentions', async () => {
            const page = await livePage(companyId, pageId);
            if (page) await tellUntold(companyId, page, String(page.editedBy || page.updatedBy || ''));
        }),
        after(INDEX_QUIET_MS, 'announcing a settled doc', async () => {
            waiting.delete(key);
            const page = await livePage(companyId, pageId);
            if (page) emitPageChange(companyId, 'update', page);
        }),
    ]);
};

/* For a doc whose state is already stored: announces it only if an autosave left that waiting. */
const settleNow = async (companyId, page, actorId) => {
    if (cancel(companyId, page._id)) emitPageChange(companyId, 'update', page);
    await tellUntold(companyId, page, actorId).catch(logged('settling doc mentions'));
};

const forgetAll = () => {
    waiting.forEach((timers) => timers.forEach(clearTimeout));
    waiting.clear();
};

module.exports = { MENTION_QUIET_MS, INDEX_QUIET_MS, namedIn, toldOf, untoldIn, tell, cancel, settleLater, settleNow, forgetAll };
