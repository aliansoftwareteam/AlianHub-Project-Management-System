const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { resolveSheetScope, scopedTimeMatch, asList, SHEET_PERMISSION } = require("../helpers/timeScope");
const { checkStages, isPlainObject, TimesheetQueryRefused } = require("../helpers/timesheetQueryScope");

const STAGE_OF_PARAMETER = Object.freeze([['sort', '$sort'], ['group', '$group'], ['addFields', '$addFields'], ['facet', '$facet']]);

const namedStages = (body) => STAGE_OF_PARAMETER.filter(([parameter]) => body[parameter]).map(([parameter, stage]) => {
    const value = body[parameter];
    if (!isPlainObject(value) || Object.keys(value).length !== 1 || !Object.prototype.hasOwnProperty.call(value, stage)) {
        throw new TimesheetQueryRefused(`${parameter} must be a single ${stage} stage.`);
    }
    return value;
});

exports.getTimeLogTimeSheet = async(req,res) => {
    try {
        const body = req.body || {};
        const { taskIds, startDate, endDate, usersFilterIDsArray } = body;
        const scope = await resolveSheetScope(req.headers['companyid'], req.uid, [SHEET_PERMISSION.tracker, SHEET_PERMISSION.workload]);

        const timeQuery = {
            ...scopedTimeMatch(scope, { userIds: asList(usersFilterIDsArray).length ? usersFilterIDsArray : null }),
            TicketID: { $in: asList(taskIds).map((task) => task && task.TicketID).filter((id) => typeof id === 'string') },
        };
        if (startDate && endDate) {
            timeQuery.LogStartTime = {
                $gte: new Date(startDate).getTime() / 1000,
                $lte: new Date(endDate).getTime() / 1000
            };
        }

        let query;
        try {
            query = [{ $match: timeQuery }, ...checkStages(namedStages(body), scope)];
        } catch (error) {
            if (!(error instanceof TimesheetQueryRefused)) throw error;
            return res.status(400).json({ status: false, statusText: "Bad Request", message: error.message });
        }

        const timesheetData = await MongoDbCrudOpration(req.headers['companyid'], { type: SCHEMA_TYPE.TIMESHEET, data: [query] }, 'aggregate');

        if (!timesheetData) {
            return res.status(404).json({ message: "TimeSheet Data not found" });
        }

        res.status(200).json(timesheetData);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the TimeSheet Data.", error: error.message });
    }
}
