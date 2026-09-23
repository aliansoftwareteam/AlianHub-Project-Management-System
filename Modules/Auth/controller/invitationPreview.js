const crypto = require('crypto');
const logger = require('../../../Config/loggerConfig');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const PENDING = 1;

/* Compared in constant time; a row with no stored token (already used, or sent before links
 * carried one) accepts nothing. */
const linkTokenAccepted = (stored, provided) => {
    const expected = Buffer.from(String(stored || ''));
    if (!expected.length) return false;
    const given = Buffer.from(String(provided || ''));
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

exports.linkTokenAccepted = linkTokenAccepted;

const INVALID = Object.freeze({ status: false, statusText: 'Invalid invitation link.' });

/* The invitation page runs before the invitee has an account, so it gets only the fields it
 * renders, and only while the invitation is still waiting for them. */
exports.invitationPreview = async (req, res) => {
    try {
        const { companyId, memberId, linkId } = req.body || {};
        if (!OBJECT_ID_PATTERN.test(String(companyId || '')) || !OBJECT_ID_PATTERN.test(String(memberId || ''))) {
            return res.send({ ...INVALID });
        }
        const member = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [{ _id: memberId }, { status: 1, userEmail: 1, linkId: 1, isDelete: 1 }] }, 'findOne');
        if (!member || member.isDelete === true || member.status !== PENDING || !linkTokenAccepted(member.linkId, linkId)) {
            return res.send({ ...INVALID });
        }
        const company = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{ _id: companyId }, { Cst_CompanyName: 1 }] }, 'findOne');
        if (!company) return res.send({ ...INVALID });
        return res.send({
            status: true,
            statusText: 'Invitation found.',
            data: {
                workspaceName: company.Cst_CompanyName || '',
                status: member.status,
                email: member.userEmail,
            },
        });
    } catch (error) {
        logger.error(`invitation preview: ${error?.message || error}`);
        return res.status(500).send({ status: false, statusText: 'Could not read the invitation.' });
    }
};
