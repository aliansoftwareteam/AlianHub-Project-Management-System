const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const R = require('./helpers/ptoRules');

const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);
const audit = (req, entry) => { try { require('../Audit/recorder').recordAuditFromReq(req, entry); } catch (e) { /* best-effort */ } };

// POST /api/v1/pto — create a PTO entry. A member creates their own (pending);
// owner/admin may create for another user and/or set status (e.g. auto-approve).
exports.createPto = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const roleType = await getRoleType(companyId, req.uid);
        const privileged = isPrivileged(roleType);
        const body = req.body || {};
        const targetUser = privileged && body.userId ? String(body.userId) : String(req.uid);
        const status = privileged && body.status ? body.status : 'pending';
        const check = R.validatePtoEntry({ ...body, userId: targetUser, status });
        if (!check.valid) return res.status(400).json({ status: false, statusText: check.errors.join('; ') });
        const data = { ...check.value, createdBy: String(req.uid || ''), deletedStatusKey: 0 };
        if (check.value.status === 'approved') data.approvedBy = String(req.uid || '');
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PTO_ENTRIES, data }, 'save');
        removeCache(`pto:${companyId}`);
        audit(req, { action: 'pto.create', entityType: 'pto', entityId: String(saved._id), meta: { type: data.type, userId: targetUser } });
        return res.status(201).json({ status: true, statusText: 'PTO entry created.', data: saved });
    } catch (e) { logger.error(`createPto: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// GET /api/v1/pto?userId=&from=&to=&status= — list (calendar feed). A member sees
// their own; owner/admin see everyone (optionally filtered by userId).
exports.listPto = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const roleType = await getRoleType(companyId, req.uid);
        const privileged = isPrivileged(roleType);
        const q = req.query || {};
        const match = { deletedStatusKey: { $ne: 1 } };
        if (privileged) { if (q.userId) match.userId = String(q.userId); }
        else { match.userId = String(req.uid); }
        if (q.status) match.status = String(q.status);
        if (q.from || q.to) {
            const and = [];
            if (q.to) and.push({ startDate: { $lte: new Date(q.to) } });
            if (q.from) and.push({ endDate: { $gte: new Date(q.from) } });
            if (and.length) match.$and = and;
        }
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PTO_ENTRIES, data: [match, {}, { sort: { startDate: -1 } }],
        }, 'find');
        // Attach the requester's display name so the admin Team view shows WHO applied —
        // entries store only userId, and users live in the GLOBAL db. (AHE-3804)
        const ids = [...new Set((rows || []).map((r) => String(r.userId)).filter((v) => mongoose.Types.ObjectId.isValid(v)))];
        const users = ids.length ? await MongoDbCrudOpration('global', {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } }, { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1, Employee_Email: 1 }],
        }, 'find').catch(() => []) : [];
        const nameById = {};
        for (const u of (users || [])) {
            nameById[String(u._id)] = u.Employee_Name || `${u.Employee_FName || ''} ${u.Employee_LName || ''}`.trim() || u.Employee_Email || '';
        }
        const data = (rows || []).map((r) => {
            const o = typeof r.toObject === 'function' ? r.toObject() : r;
            // totalDays = working days in the entry's range × (hoursPerDay / full day),
            // so a half-day entry reads as 0.5 (drives the "Total Days" column).
            return { ...o, userName: nameById[String(o.userId)] || '', totalDays: R.leaveDays(o) };
        });
        return res.json({ status: true, data });
    } catch (e) { logger.error(`listPto: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// PUT /api/v1/pto/:id/status — approve / reject (owner/admin only).
exports.updatePtoStatus = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const roleType = await getRoleType(companyId, req.uid);
        if (!isPrivileged(roleType)) return res.status(403).json({ status: false, statusText: 'Owner/admin only.' });
        const status = String(req.body.status || '');
        if (!R.PTO_STATUS.includes(status)) return res.status(400).json({ status: false, statusText: 'Invalid status.' });
        const id = req.params.id;
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PTO_ENTRIES,
            data: [{ _id: new mongoose.Types.ObjectId(String(id)) }, { $set: { status, approvedBy: String(req.uid || '') } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return res.status(404).json({ status: false, statusText: 'Not found.' });
        removeCache(`pto:${companyId}`);
        audit(req, { action: `pto.${status}`, entityType: 'pto', entityId: String(id) });
        return res.json({ status: true, statusText: `PTO ${status}.`, data: updated });
    } catch (e) { logger.error(`updatePtoStatus: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// DELETE /api/v1/pto/:id — soft-delete. The entry's owner, or any owner/admin.
exports.deletePto = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const roleType = await getRoleType(companyId, req.uid);
        const privileged = isPrivileged(roleType);
        const id = req.params.id;
        const entry = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PTO_ENTRIES, data: [{ _id: new mongoose.Types.ObjectId(String(id)) }],
        }, 'findOne');
        if (!entry) return res.status(404).json({ status: false, statusText: 'Not found.' });
        if (!privileged && String(entry.userId) !== String(req.uid)) {
            return res.status(403).json({ status: false, statusText: 'You can only remove your own time off.' });
        }
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PTO_ENTRIES,
            data: [{ _id: new mongoose.Types.ObjectId(String(id)) }, { $set: { deletedStatusKey: 1 } }],
        }, 'updateOne');
        removeCache(`pto:${companyId}`);
        return res.json({ status: true, statusText: 'PTO entry removed.' });
    } catch (e) { logger.error(`deletePto: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// GET /api/v1/pto/capacity?userId=&from=&to=&hoursPerDay= — available capacity for
// a user over a range, with APPROVED PTO subtracted. This is the SEC-08 done-when:
// PTO entries reduce a user's available capacity (feeds REP-06 capacity planning).
exports.getCapacity = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const roleType = await getRoleType(companyId, req.uid);
        const privileged = isPrivileged(roleType);
        const q = req.query || {};
        const userId = privileged && q.userId ? String(q.userId) : String(req.uid);
        if (!q.from || !q.to) return res.status(400).json({ status: false, statusText: 'from and to are required.' });
        const workingHoursPerDay = Number(q.hoursPerDay) > 0 ? Number(q.hoursPerDay) : R.DEFAULT_HOURS_PER_DAY;
        const entries = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PTO_ENTRIES,
            data: [{
                userId, status: 'approved', deletedStatusKey: { $ne: 1 },
                startDate: { $lte: new Date(q.to) }, endDate: { $gte: new Date(q.from) },
            }],
        }, 'find');
        const capacity = R.computeAvailableCapacity({
            rangeStart: q.from, rangeEnd: q.to, ptoEntries: entries || [], workingHoursPerDay,
        });
        return res.json({ status: true, data: { userId, from: q.from, to: q.to, ...capacity } });
    } catch (e) { logger.error(`getCapacity: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};
