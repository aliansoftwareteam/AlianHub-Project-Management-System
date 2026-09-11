const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { summarize } = require("../helpers/billableRules");
const { resolveTimeScope } = require("../helpers/timeScope");
const logger = require("../../../Config/loggerConfig");

// TIME-02 — billable vs non-billable summary for a set of users over a period.
// LogStartTime is stored in Unix SECONDS; callers pass start/end in seconds
// (the existing timesheet views already work in seconds). Entries with no
// `billable` field count as billable (schema default).
exports.getBillableSummary = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || (req.body && req.body.companyId);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const { userArray = [], projectArray = [], start, end } = req.body || {};
        const match = {};
        const scope = await resolveTimeScope(companyId, req.uid);
        if (!scope.companyWide) match.Loggeduser = scope.uid;
        else if (Array.isArray(userArray) && userArray.length) match.Loggeduser = { $in: userArray };
        if (Array.isArray(projectArray) && projectArray.length) match.ProjectId = { $in: projectArray };
        if (start && end) match.LogStartTime = { $gte: Number(start), $lte: Number(end) };
        const entries = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [match, { billable: 1, LogTimeDuration: 1 }],
        }, 'find');
        return res.send({ status: true, statusText: 'OK', data: { ...summarize(entries), scope: scope.label } });
    } catch (error) {
        logger.error(`ERROR in billable summary: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
