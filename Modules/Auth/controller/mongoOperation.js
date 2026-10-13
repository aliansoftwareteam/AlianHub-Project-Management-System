const logger = require('../../../Config/loggerConfig');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { resolveSheetScope, scopedTimeMatch, SHEET_PERMISSION } = require('../../TimeSheet/helpers/timeScope');
const { replaceObjectKey } = require('../helper');
const { checkGatewayRequest, toPlainResult } = require('./mongoGatewayRules');

const STATUS_TEXT = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden' };

/* Time rows answer only what the timesheet screens would show the caller; the scope stage runs first, so
 * nothing later in the client's pipeline can reach a row outside it. It is added after replaceObjectKey,
 * which would flatten its ObjectIds into plain objects. */
const scopedDataObj = async (checked, uid) => {
    const dataObj = replaceObjectKey(checked.dataObj, ['objId']);
    if (checked.collection !== dbCollections.TIMESHEET) return dataObj;
    const scope = await resolveSheetScope(checked.dbName, uid, Object.values(SHEET_PERMISSION));
    const [pipeline] = dataObj;
    return [[{ $match: scopedTimeMatch(scope) }, ...pipeline]];
};

exports.mongoOperation = async (req, res) => {
    if (!req.uid) {
        return res.status(401).json({ status: false, statusText: 'Unauthorized', message: 'A session is required.' });
    }
    const checked = checkGatewayRequest(req.body, { companyId: req.headers && req.headers.companyid });
    if (!checked.ok) {
        return res.status(checked.statusCode).json({ status: false, statusText: STATUS_TEXT[checked.statusCode], message: checked.message });
    }
    try {
        const result = await MongoDbCrudOpration(
            checked.dbName,
            { type: checked.collection, data: await scopedDataObj(checked, req.uid) },
            checked.methodName,
        );
        return res.status(200).json({ status: true, statusText: 'OK', data: toPlainResult(result) });
    } catch (error) {
        logger.error(`ERR: mongo gateway ${checked.collection} ${checked.methodName} > ${error && error.message ? error.message : error}`);
        return res.status(500).json({ status: false, statusText: 'Internal Server Error', message: 'The query could not be run.' });
    }
};
