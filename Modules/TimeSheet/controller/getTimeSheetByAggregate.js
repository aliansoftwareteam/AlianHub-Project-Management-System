const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { replaceObjectKey } = require("../../Auth/helper");
const { resolveSheetScope, SHEET_PERMISSION } = require("../helpers/timeScope");
const { scopeTimesheetPipeline, TimesheetQueryRefused } = require("../helpers/timesheetQueryScope");

exports.getTimeSheetByAggregate = async (req,res) => {
    try {
        const companyId = req.headers['companyid'];
        const scope = await resolveSheetScope(companyId, req.uid, [SHEET_PERMISSION.tracker, SHEET_PERMISSION.workload]);
        let pipeline;
        try {
            /* replaceObjectKey rebuilds every object, so it runs before the guard adds ObjectIds. */
            pipeline = scopeTimesheetPipeline(replaceObjectKey(req.body && req.body.queryeta, ["dbDate"]), scope);
        } catch (error) {
            if (!(error instanceof TimesheetQueryRefused)) throw error;
            return res.status(400).json({ status: false, statusText: "Bad Request", message: error.message });
        }

        const timeSheetData = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TIMESHEET, data: [pipeline] }, 'aggregate');

        if (!timeSheetData) {
            return res.status(404).json({ message: "Time sheet data not found" });
        }

        res.status(200).json(timeSheetData);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the TimeSheet time.", error: error.message });
    }
}
