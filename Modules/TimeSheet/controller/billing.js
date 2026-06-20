const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { validateRateInput, buildInvoice } = require("../helpers/billingRules");
const logger = require("../../../Config/loggerConfig");

// TIME-07 — billing rates + invoicing. Rates live in the per-company
// billing_rates collection (one per scope+refId). Invoices are generated from
// billable time entries at the resolved rates (user > project > default).
const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId);

/* POST /api/v1/timesheet/rates — upsert a rate. body { scope, refId?, rate, currency?, userData } */
exports.setRate = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const { scope, refId = '', rate, currency = 'USD', userData } = req.body || {};
        const check = validateRateInput({ scope, refId, rate });
        if (!check.valid) return res.send({ status: false, statusText: check.reason });
        const ref = scope === 'default' ? '' : String(refId);
        const createdBy = userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '';
        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.BILLING_RATES,
            data: [
                { scope: String(scope), refId: ref, deletedStatusKey: 0 },
                {
                    $set: { scope: String(scope), refId: ref, rate: Number(rate), currency: String(currency || 'USD'), deletedStatusKey: 0 },
                    $setOnInsert: { createdBy },
                },
                { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
            ],
        }, 'findOneAndUpdate');
        return res.send({ status: true, statusText: 'Rate saved.', data: saved });
    } catch (error) {
        logger.error(`ERROR in setRate: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v1/timesheet/rates — list configured rates. */
exports.listRates = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const rates = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.BILLING_RATES,
            data: [{ deletedStatusKey: 0 }],
        }, 'find');
        return res.send({ status: true, statusText: 'OK', data: rates || [] });
    } catch (error) {
        logger.error(`ERROR in listRates: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v1/timesheet/generate-invoice
 * body { start, end (seconds), userArray?, projectArray?, currency?, defaultRate? } */
exports.generateInvoice = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const { start, end, userArray = [], projectArray = [], currency = 'USD', defaultRate = 0 } = req.body || {};
        const match = { billable: { $ne: false } };
        if (start && end) match.LogStartTime = { $gte: Number(start), $lte: Number(end) };
        if (Array.isArray(userArray) && userArray.length) match.Loggeduser = { $in: userArray };
        if (Array.isArray(projectArray) && projectArray.length) match.ProjectId = { $in: projectArray };
        const entries = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [match, { Loggeduser: 1, ProjectId: 1, LogTimeDuration: 1, billable: 1 }],
        }, 'find');
        const rates = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.BILLING_RATES,
            data: [{ deletedStatusKey: 0 }],
        }, 'find');
        const invoice = buildInvoice({ entries: entries || [], rates: rates || [], currency, defaultRate });
        return res.send({ status: true, statusText: 'Invoice generated.', data: invoice });
    } catch (error) {
        logger.error(`ERROR in generateInvoice: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
