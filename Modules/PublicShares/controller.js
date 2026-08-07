const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const { validateCreateShare, generateShareToken, isObjectIdString } = require('./helpers/shareRules');
const bcrypt = require('bcrypt');

// Parse a client-supplied expiry into a Date (null when absent / to clear).
const parseExpiry = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
};
// Never expose passwordHash to the client; surface a hasPassword boolean instead.
const sanitizeShare = (doc) => {
    if (!doc) return doc;
    const obj = doc.toObject ? doc.toObject() : { ...doc };
    obj.hasPassword = !!obj.passwordHash;
    delete obj.passwordHash;
    return obj;
};

// Public share links. The share lives in the company DB; a tiny lookup row
// in the GLOBAL DB maps token -> company so unauthenticated public requests
// can resolve their tenant first.

/**
 * A doc may only be published by someone who can already open it.
 *
 * Without this, any entityId would do: a member could mint a public link to a
 * colleague's private doc — a link that needs no login — purely by knowing its
 * id. Returns { ok, reason }.
 */
const canShareEntity = async ({ companyId, entityType, entityId, userId }) => {
    if (entityType !== 'page') return { ok: true, reason: '' };
    const page = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PAGES,
        data: [{ _id: new mongoose.Types.ObjectId(entityId), deletedStatusKey: 0 }],
    }, 'findOne');
    // Same wording either way, so a probe cannot tell "not yours" from "not there".
    if (!page) return { ok: false, reason: 'Doc not found.' };
    if (String(page.visibility || '') === 'private') {
        return String(page.createdBy || '') === userId
            // A public link on a private doc would contradict the doc's own setting the
            // moment it was copied, and the renderer refuses to serve it anyway.
            ? { ok: false, reason: 'This doc is private. Set it to Shared before creating a public link.' }
            : { ok: false, reason: 'Doc not found.' };
    }
    return { ok: true, reason: '' };
};

/* POST /api/v2/public-shares  body: { entityType:'sprint'|'report'|'page', entityId, allowIntake? } */
exports.createShare = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { entityType, entityId, allowIntake, password, expiresAt } = req.body || {};
        const check = validateCreateShare({ companyId, entityType, entityId });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }

        // Taken from the JWT, never the body: a caller-supplied id would let anyone
        // record the link as someone else's work.
        const userId = String(req.uid || '');
        const allowed = await canShareEntity({ companyId, entityType, entityId, userId });
        if (!allowed.ok) {
            return res.send({ status: false, statusText: allowed.reason });
        }

        const existing = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PUBLIC_SHARES,
            data: [{ entityType, entityId: new mongoose.Types.ObjectId(entityId) }],
        }, 'findOne');
        if (existing) {
            // Sanitized like every other return path — this one handed back the raw row,
            // passwordHash included.
            return res.send({ status: true, statusText: 'Share already exists.', data: sanitizeShare(existing) });
        }

        const token = generateShareToken();
        const shareData = {
            entityType,
            entityId: new mongoose.Types.ObjectId(entityId),
            token,
            enabled: true,
            allowIntake: allowIntake === true,
            createdBy: userId,
        };
        const exp = parseExpiry(expiresAt);
        if (exp) shareData.expiresAt = exp;
        if (password && String(password).length) shareData.passwordHash = await bcrypt.hash(String(password), 10);

        const share = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PUBLIC_SHARES,
            data: shareData,
        }, 'save');

        await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.PUBLIC_SHARE_INDEX,
            data: { token, companyId, shareId: share._id },
        }, 'save');

        return res.send({ status: true, statusText: 'Public link created.', data: sanitizeShare(share) });
    } catch (error) {
        logger.error(`ERROR in create public share: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/public-shares?entityId= */
exports.getShare = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const entityId = String(req.query?.entityId || '');
        if (!companyId || !isObjectIdString(entityId)) {
            return res.send({ status: false, statusText: 'companyId and a valid entityId are required.' });
        }
        const share = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PUBLIC_SHARES,
            data: [{ entityId: new mongoose.Types.ObjectId(entityId) }],
        }, 'findOne');
        // The token IS the access. Handing one out for a doc the caller cannot open would
        // undo the check that stopped them creating it.
        if (share && share.entityType === 'page') {
            const allowed = await canShareEntity({
                companyId, entityType: 'page', entityId, userId: String(req.uid || ''),
            });
            // 'Set it to Shared' means the doc is theirs and merely private — they may
            // still see the link they made. Anything else is a refusal.
            if (!allowed.ok && allowed.reason === 'Doc not found.') {
                return res.send({ status: true, statusText: 'Share fetched.', data: null });
            }
        }
        return res.send({ status: true, statusText: 'Share fetched.', data: sanitizeShare(share) });
    } catch (error) {
        logger.error(`ERROR in get public share: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* PUT /api/v2/public-shares/:id  body: { enabled?, allowIntake? } */
exports.updateShare = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid share id are required.' });
        }
        const { enabled, allowIntake, expiresAt, password } = req.body || {};
        const update = {};
        if (enabled !== undefined) update.enabled = enabled === true;
        if (allowIntake !== undefined) update.allowIntake = allowIntake === true;
        if (expiresAt !== undefined) update.expiresAt = parseExpiry(expiresAt); // null clears expiry
        if (password !== undefined) update.passwordHash = (password && String(password).length) ? await bcrypt.hash(String(password), 10) : null; // empty clears the password
        if (!Object.keys(update).length) {
            return res.send({ status: false, statusText: 'Nothing to update.' });
        }
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PUBLIC_SHARES,
            data: [{ _id: new mongoose.Types.ObjectId(id) }, { $set: update }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) {
            return res.send({ status: false, statusText: 'Share not found.' });
        }
        return res.send({ status: true, statusText: 'Share updated.', data: sanitizeShare(updated) });
    } catch (error) {
        logger.error(`ERROR in update public share: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* DELETE /api/v2/public-shares/:id — hard revoke: removes the share + its global index row. */
exports.deleteShare = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { id } = req.params;
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid share id are required.' });
        }
        const removed = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PUBLIC_SHARES,
            data: [{ _id: new mongoose.Types.ObjectId(id) }],
        }, 'findOneAndDelete');
        if (removed && removed.token) {
            await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
                type: SCHEMA_TYPE.PUBLIC_SHARE_INDEX,
                data: [{ token: removed.token }],
            }, 'deleteOne').catch((e) => logger.error(`ERROR removing share index: ${e.message}`));
        }
        return res.send({ status: true, statusText: 'Public link deleted.' });
    } catch (error) {
        logger.error(`ERROR in delete public share: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/intake?shareId= — pending submissions for review. */
exports.listIntake = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const shareId = String(req.query?.shareId || '');
        if (!companyId || !isObjectIdString(shareId)) {
            return res.send({ status: false, statusText: 'companyId and a valid shareId are required.' });
        }
        const items = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTAKE_ITEMS,
            data: [{ publicShareId: new mongoose.Types.ObjectId(shareId), status: 'pending' }, null, { sort: { createdAt: -1 }, limit: 100 }],
        }, 'find');
        return res.send({ status: true, statusText: 'Intake fetched.', data: items || [] });
    } catch (error) {
        logger.error(`ERROR in list intake: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/intake/review  body: { intakeId, action: 'accept'|'reject' } —
 * accepting marks the item; turning it into a task stays a manual step for
 * now (documented follow-up: auto-create through the task pipeline). */
exports.reviewIntake = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { intakeId, action } = req.body || {};
        if (!companyId || !isObjectIdString(intakeId) || !['accept', 'reject'].includes(action)) {
            return res.send({ status: false, statusText: 'companyId, intakeId and a valid action are required.' });
        }
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTAKE_ITEMS,
            data: [
                { _id: new mongoose.Types.ObjectId(intakeId), status: 'pending' },
                { $set: { status: action === 'accept' ? 'accepted' : 'rejected' } },
                { returnDocument: 'after' },
            ],
        }, 'findOneAndUpdate');
        if (!updated) {
            return res.send({ status: false, statusText: 'Intake item not found or already reviewed.' });
        }
        return res.send({ status: true, statusText: `Submission ${updated.status}.`, data: updated });
    } catch (error) {
        logger.error(`ERROR in review intake: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
