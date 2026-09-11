const logger = require('../../../Config/loggerConfig');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const PENDING = 1;

/* The invitation page runs before the invitee has an account, so it gets only the fields
 * it renders; the email is withheld once the invitation is no longer pending. */
exports.invitationPreview = async (req, res) => {
    try {
        const { companyId, memberId } = req.body || {};
        if (!OBJECT_ID_PATTERN.test(String(companyId || '')) || !OBJECT_ID_PATTERN.test(String(memberId || ''))) {
            return res.send({ status: false, statusText: 'Invalid invitation link.' });
        }
        const company = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{ _id: companyId }, { Cst_CompanyName: 1 }] }, 'findOne');
        if (!company) return res.send({ status: false, statusText: 'Invalid invitation link.' });
        const member = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ _id: memberId }, { status: 1, userEmail: 1 }] }, 'findOne');
        if (!member) return res.send({ status: false, statusText: 'Invalid invitation link.' });
        return res.send({
            status: true,
            statusText: 'Invitation found.',
            data: {
                workspaceName: company.Cst_CompanyName || '',
                status: member.status,
                email: member.status === PENDING ? member.userEmail : '',
            },
        });
    } catch (error) {
        logger.error(`invitation preview: ${error?.message || error}`);
        return res.status(500).send({ status: false, statusText: 'Could not read the invitation.' });
    }
};
