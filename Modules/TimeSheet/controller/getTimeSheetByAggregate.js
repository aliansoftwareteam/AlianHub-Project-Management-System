const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { replaceObjectKey } = require("../../Auth/helper");

exports.getTimeSheetByAggregate = async (req,res) => {
    try {
        const query = replaceObjectKey(req.body.queryeta, ["dbDate"])

        const estObj = {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [query]
        };
        const timeSheetData = await MongoDbCrudOpration(req.headers['companyid'], estObj, 'aggregate');

        if (!timeSheetData) {
            return res.status(404).json({ message: "Time sheet data not found" });
        }

        res.status(200).json(timeSheetData);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the TimeSheet time.", error: error.message });
    }
}