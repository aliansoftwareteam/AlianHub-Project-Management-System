const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { replaceObjectKey } = require("../Auth/helper");

exports.getInvoice = async(req,res) => {
    try {
        const { findQuery } = req.body;

        if (!findQuery) {
            return res.status(400).json({
                message: "An error occurred while getting the task.",
                error: "Query is required."
            });
        }
        let query = replaceObjectKey(findQuery, ["dbDate"]);
        const taskQuery = [query];

        const taskObj = {
            type: SCHEMA_TYPE.INVOICES,
            data: [taskQuery]
        };

        const response = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, taskObj, 'aggregate');

        return res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the invoice.", error: error.message });
    }
}