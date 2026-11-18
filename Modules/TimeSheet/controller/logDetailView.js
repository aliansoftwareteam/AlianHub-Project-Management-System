const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { resolveSheetScope, scopedTimeMatch, asList, SHEET_PERMISSION } = require("../helpers/timeScope");

exports.getlogDetailTimeSheet = async(req,res) => {
    try {
        const { taskId, startDate, endDate, userArray, projectId } = req.body || {};
        const companyId = req.headers['companyid'];
        const scope = await resolveSheetScope(companyId, req.uid, [SHEET_PERMISSION.user, SHEET_PERMISSION.project]);
        const projectIds = Array.isArray(projectId) ? projectId : [projectId].filter(Boolean);

        const timeQuery = {
            ...scopedTimeMatch(scope, {
                userIds: asList(userArray).length ? userArray : null,
                projectIds: projectIds.length ? projectIds : null,
            }),
            LogStartTime: {
                $gte: Number(startDate),
                $lte: Number(endDate),
            },
        };
        if (typeof taskId === 'string' && taskId) {
            timeQuery.TicketID = taskId;
        }

        const timesheetData = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TIMESHEET, data: [[{ $match: timeQuery }]] }, 'aggregate');

        if (!timesheetData) {
            return res.status(404).json({ message: "TimeSheet Data not found" });
        }

        res.status(200).json(timesheetData);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the TimeSheet Data.", error: error.message });
    }
}
