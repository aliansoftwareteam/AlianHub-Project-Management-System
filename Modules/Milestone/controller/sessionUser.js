const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { ROLE_OWNER } = require('../../../Config/roleTypes');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries.js');
const { actingUser } = require('../../Sprints/helpers/actingUser');
const { escapeHtml } = require('../../../utils/escapeHtml');

/* Milestone history and notifications name the signed-in user, as billing.js does; the userDetail
 * the client still sends is ignored. The owner is looked up here because project notifications
 * always copy the company owner in, and the client used to supply that id too. */
async function milestoneUser(req, res, companyId) {
    const actor = await actingUser(req);
    if (!actor) {
        res.status(401).send({ status: false, statusText: 'A signed-in user is required.' });
        return null;
    }
    const owner = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ roleType: ROLE_OWNER, isDelete: { $ne: true } }, { userId: 1 }],
    }, 'findOne').catch(() => null);
    return {
        id: actor.id,
        Employee_Name: escapeHtml(actor.Employee_Name),
        companyOwnerId: owner && owner.userId ? String(owner.userId) : '',
    };
}

module.exports = { milestoneUser };
