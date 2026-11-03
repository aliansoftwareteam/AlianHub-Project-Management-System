const { DateTime } = require('luxon');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const logger = require('../../../Config/loggerConfig');
const { sessionTenantOf, TenantError } = require('../../../Config/tenant');
const { resolveSheetScope, scopedTimeMatch, scopedEstimateMatch, SHEET_PERMISSION } = require('../helpers/timeScope');

const MAX_PEOPLE = 200;
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const safeZone = (z) => (z && DateTime.local().setZone(z).isValid ? z : 'UTC');

const addAll = (map, rows, userField) => (rows || []).forEach((row) => {
    const uid = String((row._id && row._id[userField]) || '');
    const pid = String((row._id && row._id.p) || '');
    if (!uid || !pid) return;
    (map[uid] || (map[uid] = new Set())).add(pid);
});

// POST /api/v1/timesheet/report-facets  body: { start, end, userIds, timeZone? }
// For the Time reports' filter bar: the projects each chosen person logged or planned time in over the range, as far
// as the caller's time scope reads.
exports.getReportFacets = async (req, res) => {
    try {
        const companyId = sessionTenantOf(req);
        const b = req.body || {};
        if (!isDay(b.start) || !isDay(b.end)) return res.status(400).json({ status: false, statusText: 'start and end (YYYY-MM-DD) are required.' });
        const userIds = [...new Set((Array.isArray(b.userIds) ? b.userIds : []).map(String).filter(Boolean))].slice(0, MAX_PEOPLE);
        if (!userIds.length) return res.json({ status: true, statusText: 'OK', data: { projectsByUser: {} } });
        const zone = safeZone(b.timeZone);
        const scope = await resolveSheetScope(companyId, req.uid, Object.values(SHEET_PERMISSION));
        const startSec = Math.floor(DateTime.fromISO(b.start, { zone }).startOf('day').toSeconds());
        const endSec = Math.floor(DateTime.fromISO(b.end, { zone }).endOf('day').toSeconds());

        const timeMatch = { ...scopedTimeMatch(scope, { userIds }), LogStartTime: { $gte: startSec, $lte: endSec } };
        const planMatch = {
            ...scopedEstimateMatch(scope),
            $and: [{ UserId: { $in: userIds } }],
            Date: { $gte: new Date(`${b.start}T00:00:00.000Z`), $lte: new Date(`${b.end}T23:59:59.999Z`) },
        };
        const [logged, planned] = await Promise.all([
            MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TIMESHEET, data: [[{ $match: timeMatch }, { $group: { _id: { u: '$Loggeduser', p: { $toString: '$ProjectId' } } } }]] }, 'aggregate').catch(() => []),
            MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.ESTIMATES_TIME, data: [[{ $match: planMatch }, { $group: { _id: { u: '$UserId', p: { $toString: '$ProjectId' } } } }]] }, 'aggregate').catch(() => []),
        ]);
        const byUser = {};
        addAll(byUser, logged, 'u');
        addAll(byUser, planned, 'u');
        const projectsByUser = Object.fromEntries(Object.entries(byUser).map(([uid, set]) => [uid, [...set]]));
        return res.json({ status: true, statusText: 'OK', data: { projectsByUser } });
    } catch (e) {
        if (e instanceof TenantError) return res.status(e.statusCode).json({ status: false, statusText: e.message });
        logger.error(`getReportFacets: ${e.message}`);
        return res.status(500).json({ status: false, statusText: e.message });
    }
};
