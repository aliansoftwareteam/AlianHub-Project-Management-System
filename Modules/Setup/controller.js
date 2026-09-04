const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { checkDb } = require('../Instance/health');
const { computeSetupStatus, validateSetupPayload } = require('./helpers');
const { emitListener } = require('./events');

let installedOnce = false;

async function countUsers() {
    return MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{}] }, 'countDocuments');
}

/* Once a user exists the answer never changes for the life of the process, so the
 * router guard that asks on every navigation costs nothing after the first call. */
async function readStatus() {
    const db = await checkDb();
    if (!db.ok) return computeSetupStatus({ db, userCount: 0 });
    if (!installedOnce) installedOnce = (await countUsers()) > 0;
    return computeSetupStatus({ db, userCount: installedOnce ? 1 : 0 });
}

exports.resetInstalledFlag = () => { installedOnce = false; };

exports.getStatus = async (req, res) => {
    try {
        res.send({ status: true, statusText: 'Setup status.', data: await readStatus() });
    } catch (error) {
        res.status(500).send({ status: false, statusText: error.message });
    }
};

exports.complete = async (req, res) => {
    const { data, errors, valid } = validateSetupPayload(req.body);
    if (!valid) return res.status(400).send({ status: false, statusText: 'Some fields need attention.', data: { errors } });
    const emit = (step) => emitListener(data.eventId, { step });
    try {
        const status = await readStatus();
        if (!status.dbOk) return res.status(503).send({ status: false, statusText: status.dbError });
        if (status.installed) return res.status(409).send({ status: false, statusText: 'This instance is already set up. Log in instead.' });

        const { startInitialization } = require('./initalizations');
        const { createOwner, createFirstCompany } = require('./createCompany');
        const { finalizeSession } = require('../Auth/controller/loginSession');

        emit('seeds');
        await startInitialization();
        emit('account');
        const userId = await createOwner(data);
        const companyId = await createFirstCompany({ ...data, userId, onStep: emit });
        installedOnce = true;

        finalizeSession(req, res, userId, () => {
            emit('STOP');
            res.status(200).send({ status: true, statusText: 'Set up, but the session could not be started. Log in.', data: { userId, companyId, session: false } });
        }, (session) => {
            emit('STOP');
            res.status(200).send({ status: true, statusText: 'Instance set up.', data: { userId, companyId, session: true, ...session } });
        });
    } catch (error) {
        logger.error(`setup: complete failed: ${error?.message || error}`);
        emitListener(data.eventId, { step: 'STOP', error: error?.message || String(error) });
        res.status(500).send({ status: false, statusText: error?.message || 'Setup failed.' });
    }
};
