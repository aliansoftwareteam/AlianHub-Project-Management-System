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

/* POST /api/v2/public-shares  body: { entityType:'sprint', entityId, allowIntake?, userData } */
exports.createShare = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { entityType, entityId, allowIntake, userData, password, expiresAt } = req.body || {};
        const check = validateCreateShare({ companyId, entityType, entityId });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }

        const existing = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PUBLIC_SHARES,
            data: [{ entityType, entityId: new mongoose.Types.ObjectId(entityId) }],
        }, 'findOne');
        if (existing) {
            return res.send({ status: true, statusText: 'Share already exists.', data: existing });
        }

        const token = generateShareToken();
        const shareData = {
            entityType,
            entityId: new mongoose.Types.ObjectId(entityId),
            token,
            enabled: true,
            allowIntake: allowIntake === true,
            createdBy: userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '',
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
