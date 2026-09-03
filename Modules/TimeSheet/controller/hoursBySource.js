const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { humanHoursFromEntries } = require("../helpers/timelogSourceSplit");
const logger = require("../../../Config/loggerConfig");

// GET /api/v1/timesheet/hours-by-source?start=&end= (handoff 27c) — the people
// half of the hours-by-source bar. One number, not a split: a time log records
// who logged it and how long, and nothing that could stand in for the agent
// `viaAccount` axis, which says which AI account paid for a model run.
// LogStartTime is stored in Unix SECONDS, as the other timesheet endpoints use.
exports.getHoursBySource = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || (req.query && req.query.companyId);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });

        const start = Number(req.query && req.query.start);
        const end = Number(req.query && req.query.end);
        const match = { actorType: { $ne: 'agent' } };
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
            },
        });
    } catch (error) {
        logger.error(`ERROR in hours by source: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
