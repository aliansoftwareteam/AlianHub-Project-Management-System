const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const pto = require('../Pto/helpers/ptoRules');   // SEC-08 — capacity = work hours − approved PTO
const R = require('./helpers/capacityRules');

const companyOf = (req) => req.headers['companyid'] || (req.query && req.query.companyId);
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

// GET /api/v1/reports/capacity?from=&to=&hoursPerDay=
// Per-member capacity (working hours − approved PTO) vs allocation (planned hours
// from estimated_time), with over-allocation flagged. companyId-scoped.
exports.getCapacityPlan = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const q = req.query || {};
        if (!q.from || !q.to) return res.status(400).json({ status: false, statusText: 'from and to are required.' });
        const hoursPerDay = Number(q.hoursPerDay) > 0 ? Number(q.hoursPerDay) : 8;

        const members = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS, data: [{ isDelete: { $ne: true } }, { userId: 1, userEmail: 1 }],
        }, 'find');
        const userIds = [...new Set((members || []).map((m) => String(m.userId)).filter(Boolean))];
        if (!userIds.length) return res.json({ status: true, data: { from: q.from, to: q.to, totals: R.summarize([]), users: [] } });

        // Display names from the global users collection.
        const gusers = await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: { $in: userIds.map(oid).filter(Boolean) } }, { Employee_Name: 1, Employee_Email: 1 }],
        }, 'find').catch(() => []);
        const nameById = {};
        (gusers || []).forEach((u) => { nameById[String(u._id)] = u.Employee_Name || u.Employee_Email || ''; });

        // Approved PTO overlapping the window, grouped by user.
        const ptoRows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PTO_ENTRIES,
            data: [{ userId: { $in: userIds }, status: 'approved', deletedStatusKey: { $ne: 1 }, startDate: { $lte: new Date(q.to) }, endDate: { $gte: new Date(q.from) } }],
        }, 'find').catch(() => []);
        const ptoByUser = {};
        (ptoRows || []).forEach((p) => { (ptoByUser[String(p.userId)] = ptoByUser[String(p.userId)] || []).push(p); });

        // Planned/allocated time (estimated_time, MINUTES) in the window, summed by user.
        const estRows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.ESTIMATES_TIME,
            data: [{ UserId: { $in: userIds }, Date: { $gte: new Date(q.from), $lte: new Date(q.to) } }, { UserId: 1, EstimatedTime: 1 }],
        }, 'find').catch(() => []);
        const allocMinByUser = {};
        (estRows || []).forEach((e) => { allocMinByUser[String(e.UserId)] = (allocMinByUser[String(e.UserId)] || 0) + (Number(e.EstimatedTime) || 0); });

        const rows = userIds.map((uid) => {
            const cap = pto.computeAvailableCapacity({ rangeStart: q.from, rangeEnd: q.to, ptoEntries: ptoByUser[uid] || [], workingHoursPerDay: hoursPerDay });
            const allocatedHours = (allocMinByUser[uid] || 0) / 60;
            const util = R.userUtilization({ capacityHours: cap.availableHours, allocatedHours });
            return {
                userId: uid,
                name: nameById[uid] || '(unknown)',
                workCapacityHours: cap.totalCapacityHours,
                ptoHours: cap.ptoHours,
                ...util,
            };
        }).sort((a, b) => b.utilizationPct - a.utilizationPct);

        return res.json({ status: true, data: { from: q.from, to: q.to, totals: R.summarize(rows), users: rows } });
    } catch (e) { logger.error(`getCapacityPlan: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};
