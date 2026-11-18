const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { tenantOf } = require('../../Config/tenant');
const { fail } = require('../../Config/respond');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { isCompanyMember } = require('../../Config/contentAccess');
const { activeMemberIds } = require('../notification/activeMembers');
const { emitPageChange } = require('./helpers/pageEvents');
const { isObjectIdString, sharesOf, shareFor, SHARE_ROLES, MAX_PAGE_SHARES } = require('./helpers/pageRules');
const { canUsePage, canManageShares } = require('./helpers/pageAccess');
const { toldOf, owedNotice, notifyShared } = require('./helpers/pageShareNotices');

const SHARES_MODULE = 'pageShares';
const PAGE_NOT_FOUND = 'Page not found.';

const oid = (id) => new mongoose.Types.ObjectId(String(id));

const entryOf = (share) => ({ userId: String(share.userId), role: String(share.role), by: String(share.by || ''), at: share.at || null });

/* A person whose seat ended stays on the list, marked, until someone removes them: they reach nothing meanwhile. */
const listOf = async (companyId, page) => {
    const people = sharesOf(page).map(entryOf);
    const seated = new Set(await activeMemberIds(companyId, people.map((person) => person.userId)));
    return { people: people.map((person) => ({ ...person, active: seated.has(person.userId) })), limit: MAX_PAGE_SHARES };
};

/* The doc, when the caller manages who it is shared with; otherwise the refusal has been sent. Someone who
 * cannot read the doc hears the same as for a doc that does not exist. */
const managedPage = async (req, res) => {
    const companyId = tenantOf(req);
    const uid = String(req.uid || '');
    const { id } = req.params;
    if (!companyId || !isObjectIdString(id)) {
        fail(res, 'A valid page id is required.', 400);
        return null;
    }
    const page = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PAGES, data: [{ _id: oid(id), deletedStatusKey: 0 }] }, 'findOne');
    if (!page || !(await canUsePage(companyId, page, uid))) {
        fail(res, PAGE_NOT_FOUND, 404);
        return null;
    }
    if (!(await canManageShares(companyId, page, uid))) {
        fail(res, 'Only the author of a doc, or an owner or admin who can open it, chooses who it is shared with.', 403);
        return null;
    }
    return { companyId, uid, page };
};

const write = (companyId, page, set) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PAGES,
    data: [{ _id: oid(page._id), deletedStatusKey: 0 }, { $set: set }, { returnDocument: 'after' }],
}, 'findOneAndUpdate');

/* Says only that the person's docs changed: their client reads the list again, and the API decides what it shows. */
const tellPerson = (companyId, userId) => {
    try {
        socketEmitter.emit('update', { type: 'update', module: SHARES_MODULE, companyId: String(companyId), data: { userId: String(userId) } });
    } catch (error) {
        logger.error(`ERROR emitting a doc share change: ${error.message}`);
    }
};

const failed = (res, what, error) => {
    logger.error(`ERROR in ${what}: ${error.message}`);
    return fail(res, error.message, error.statusCode);
};

/* GET /api/v2/pages/:id/shares */
exports.listShares = async (req, res) => {
    try {
        const found = await managedPage(req, res);
        if (!found) return undefined;
        return res.send({ status: true, statusText: 'Shares fetched.', data: await listOf(found.companyId, found.page) });
    } catch (error) {
        return failed(res, 'list page shares', error);
    }
};

/* PUT /api/v2/pages/:id/shares/:userId  body: { role: 'viewer' | 'editor' } — names a person, or changes their role. */
exports.putShare = async (req, res) => {
    try {
        const found = await managedPage(req, res);
        if (!found) return undefined;
        const { companyId, uid, page } = found;
        const userId = String(req.params.userId || '');
        const role = String((req.body && req.body.role) || 'viewer');
        if (!isObjectIdString(userId)) return fail(res, 'A valid user id is required.', 400);
        if (!SHARE_ROLES.includes(role)) return fail(res, `role must be one of: ${SHARE_ROLES.join(', ')}.`, 400);
        if (!(await isCompanyMember(companyId, userId))) {
            return fail(res, 'A doc can be shared only with an active member of this workspace.', 400);
        }
        const current = sharesOf(page).map(entryOf);
        const already = shareFor(page, userId);
        if (!already && current.length >= MAX_PAGE_SHARES) {
            return fail(res, `A doc can be shared with at most ${MAX_PAGE_SHARES} people.`, 400);
        }
        const entry = { userId, role, by: uid, at: new Date() };
        const sharedWith = already ? current.map((share) => (share.userId === userId ? { ...share, role } : share)) : [...current, entry];
        const tells = !already && owedNotice(page, uid, userId);
        const updated = await write(companyId, page, { sharedWith, ...(tells ? { sharesTold: [...toldOf(page), userId] } : {}) });
        if (!updated) return fail(res, PAGE_NOT_FOUND, 404);

        emitPageChange(companyId, 'update', updated);
        tellPerson(companyId, userId);
        if (tells) {
            notifyShared({ companyId, page: updated, actorId: uid, userId, role })
                .catch((error) => logger.error(`ERROR in doc share notice: ${error.message}`));
        }
        return res.send({ status: true, statusText: 'Doc shared.', data: await listOf(companyId, updated) });
    } catch (error) {
        return failed(res, 'share page', error);
    }
};

/* DELETE /api/v2/pages/:id/shares/:userId */
exports.removeShare = async (req, res) => {
    try {
        const found = await managedPage(req, res);
        if (!found) return undefined;
        const { companyId, page } = found;
        const userId = String(req.params.userId || '');
        if (!isObjectIdString(userId)) return fail(res, 'A valid user id is required.', 400);
        if (!shareFor(page, userId)) {
            return res.send({ status: true, statusText: 'Share removed.', data: await listOf(companyId, page) });
        }
        const updated = await write(companyId, page, { sharedWith: sharesOf(page).map(entryOf).filter((share) => share.userId !== userId) });
        if (!updated) return fail(res, PAGE_NOT_FOUND, 404);

        emitPageChange(companyId, 'update', updated);
        tellPerson(companyId, userId);
        return res.send({ status: true, statusText: 'Share removed.', data: await listOf(companyId, updated) });
    } catch (error) {
        return failed(res, 'remove page share', error);
    }
};

exports.SHARES_MODULE = SHARES_MODULE;
