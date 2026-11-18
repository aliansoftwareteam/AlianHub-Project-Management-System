const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { recordAudit } = require('../Audit/recorder');
const redact = require('../Audit/redact');
const { requestAddress } = require('../../utils/requestAddress');

const ACTION = 'instance.audit_redact_person';
const ADMIN_KEY_ACTOR = 'instance-admin-key';
const OBJECT_ID = /^[a-f0-9]{24}$/i;

// The screen translates these; statusText is the English fallback for scripts.
const CODE = Object.freeze({
    INVALID_COMPANY_ID: 'invalid_company_id',
    UNKNOWN_WORKSPACE: 'unknown_workspace',
    INVALID_USER_ID: 'invalid_user_id',
    CONFIRMATION_MISMATCH: 'confirmation_mismatch',
    REDACTION_RUNNING: redact.CODE_RUNNING,
    SERVER_ERROR: 'server_error',
});

const fail = (res, status, code, statusText) => res.status(status).send({ status: false, statusText, code });

const canonicalId = (value) => (typeof value === 'string' && OBJECT_ID.test(value) ? value.toLowerCase() : '');

const byAdminKey = (req) => req.instanceAdmin === 'key';
const actorOf = (req) => (byAdminKey(req) ? ADMIN_KEY_ACTOR : String(req.uid || ''));
const userName = async (id) => {
    if (!OBJECT_ID.test(id)) return '';
    const user = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: id }, { Employee_Name: 1 }] }, 'findOne');
    return (user && user.Employee_Name) || '';
};

const audit = (req, companyId, pseudonym, meta) => {
    const actorId = actorOf(req);
    userName(actorId)
        .catch((error) => {
            logger.error(`audit redaction actor ${actorId}: ${error.message || error}`);
            return '';
        })
        .then((actorName) => recordAudit(companyId, {
            actorId,
            actorName,
            ip: requestAddress(req),
            action: ACTION,
            entityType: 'user',
            entityId: pseudonym,
            meta: byAdminKey(req) ? { ...meta, via: 'admin_key' } : meta,
        }));
};

const findCompany = (id) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
    type: SCHEMA_TYPE.COMPANIES,
    data: [{ _id: new mongoose.Types.ObjectId(id) }, 'Cst_CompanyName'],
}, 'findOne');

/* POST /api/v2/instance/audit/:companyId/redact-person { userId, confirm } */
exports.redactPerson = async (req, res) => {
    try {
        const id = String(req.params.companyId || '');
        if (!OBJECT_ID.test(id)) return fail(res, 400, CODE.INVALID_COMPANY_ID, 'companyId must be a workspace id.');
        const company = await findCompany(id);
        if (!company) return fail(res, 404, CODE.UNKNOWN_WORKSPACE, 'No such workspace.');
        const companyId = String(company._id).toLowerCase();

        const { userId, confirm } = req.body || {};
        const person = canonicalId(userId);
        if (!person) return fail(res, 400, CODE.INVALID_USER_ID, 'userId must be a user id.');
        if (canonicalId(confirm) !== person) return fail(res, 400, CODE.CONFIRMATION_MISMATCH, "Type the person's user id to confirm the redaction.");

        const pseudonym = redact.pseudonymOf(person);
        let result;
        try {
            result = await redact.redactPerson(companyId, person, { by: actorOf(req), reason: ACTION });
        } catch (error) {
            if (error && error.code === redact.CODE_RUNNING) return fail(res, 409, CODE.REDACTION_RUNNING, 'This person is already being redacted in this workspace; try again once that run ends.');
            audit(req, companyId, pseudonym, { failed: true, error: CODE.SERVER_ERROR });
            throw error;
        }
        audit(req, companyId, pseudonym, { rows: result.rows, fields: result.fields });
        return res.status(200).send({ status: true, statusText: 'Redacted.', data: { rows: result.rows, fields: result.fields, pseudonym } });
    } catch (error) {
        logger.error(`audit redaction ${req.params.companyId}: ${error.message || error}`);
        return fail(res, 500, CODE.SERVER_ERROR, 'The audit rows could not be redacted; the server log has the cause. Running it again resumes where it stopped.');
    }
};

module.exports.ACTION = ACTION;
module.exports.CODE = CODE;
