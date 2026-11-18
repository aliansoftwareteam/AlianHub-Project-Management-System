const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { replaceObjectKey } = require("../Auth/helper");
const { validateInvoicePipeline, InvoiceQueryRefused } = require("./helpers/invoiceQueryGuard");
const logger = require("../../Config/loggerConfig");

exports.getInvoice = async (req, res) => {
    logger.warn('POST /api/v1/invoice/find is deprecated: nothing writes the subscription invoices collection and the route is due for removal in the next release.');
    try {
        const { findQuery } = req.body || {};
        if (!findQuery) {
            return res.status(400).json({ status: false, statusText: "Bad Request", message: "findQuery is required." });
        }

        let pipeline;
        try {
            pipeline = validateInvoicePipeline(findQuery);
        } catch (error) {
            if (!(error instanceof InvoiceQueryRefused)) throw error;
            return res.status(400).json({ status: false, statusText: "Bad Request", message: error.message });
        }

        const response = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.INVOICES,
            data: [replaceObjectKey(pipeline, ["dbDate"])],
        }, 'aggregate');

        return res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ status: false, statusText: "An error occurred while fetching the invoice.", message: error.message });
    }
}
