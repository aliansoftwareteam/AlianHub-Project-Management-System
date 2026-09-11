const logger = require('../../../Config/loggerConfig');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { replaceObjectKey } = require('../helper');

const READ_METHODS = ['find', 'findOne', 'aggregate', 'countDocuments'];
const WRITING_STAGE = /"\$(out|merge)"/;

const refuse = (res, statusText) => res.status(403).send({ status: false, statusText });

/* A generic read for the few screens that still build their own queries. It used to take
 * any database and any model method from the body with no session; now it reads only the
 * caller's company and never writes. */
exports.mongoOperation = (req, res) => {
    const { dataObj, dbName, methodName, collection } = req.body || {};
    if (!dataObj) return res.send({ status: false, statusText: 'DataObject is missing' });
    if (!dbName) return res.send({ status: false, statusText: 'dbName is missing' });
    if (!methodName) return res.send({ status: false, statusText: 'methodName is missing' });
    if (!collection) return res.send({ status: false, statusText: 'collection is missing' });

    if (String(dbName) !== String(req.headers.companyid || '')) return refuse(res, 'dbName must be your company.');
    if (!READ_METHODS.includes(methodName)) return refuse(res, `methodName must be one of: ${READ_METHODS.join(', ')}.`);
    if (WRITING_STAGE.test(JSON.stringify(dataObj))) return refuse(res, 'A pipeline cannot use $out or $merge.');

    return MongoDbCrudOpration(dbName, { type: collection, data: replaceObjectKey(dataObj, ['objId']) }, methodName)
        .then((response) => res.send({ status: true, statusText: response }))
        .catch((error) => {
            logger.error(`ERR: in request ${collection} ${methodName} > ${error?.message ? error.message : error}`);
            res.send({ status: false, statusText: error?.message || error });
        });
};

exports.READ_METHODS = READ_METHODS;
