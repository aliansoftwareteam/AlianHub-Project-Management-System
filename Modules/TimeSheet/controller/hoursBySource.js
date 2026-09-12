const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { humanHoursFromEntries } = require("../helpers/timelogSourceSplit");
const { resolveTimeScope } = require("../helpers/timeScope");
const logger = require("../../../Config/loggerConfig");
const { sessionTenantOf, TenantError } = require('../../../Config/tenant');

// GET /api/v1/timesheet/hours-by-source?start=&end= (handoff 27c) — the people
// half of the hours-by-source bar. One number, not a split: a time log records
// who logged it and how long, and nothing that could stand in for the agent
// `viaAccount` axis, which says which AI account paid for a model run.
// LogStartTime is stored in Unix SECONDS, as the other timesheet endpoints use.
exports.getHoursBySource = async (req, res) => {
    try {
        const companyId = sessionTenantOf(req);

        const start = Number(req.query && req.query.start);
        const end = Number(req.query && req.query.end);
        const match = { actorType: { $ne: 'agent' } };
        const scope = await resolveTimeScope(companyId, req.uid);
        if (!scope.companyWide) match.Loggeduser = scope.uid;
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
            match.LogStartTime = { $gte: start, $lte: end };
        }

        const entries = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [match, { LogTimeDuration: 1, actorType: 1 }],
        }, 'find') || [];

        return res.send({
            status: true,
            statusText: 'OK',
            data: {
                peopleHours: humanHoursFromEntries(entries),
                entryCount: entries.length,
                start: match.LogStartTime ? start : null,
                end: match.LogStartTime ? end : null,
                scope: scope.label,
            },
        });
    } catch (error) {
        if (error instanceof TenantError) return res.status(error.statusCode).json({ status: false, statusText: error.message });
        logger.error(`ERROR in hours by source: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
