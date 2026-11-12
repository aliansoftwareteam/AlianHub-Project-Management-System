const flag = require('./flag');
const logger = require('../../../Config/loggerConfig');

/* Called wherever a member is removed or deactivated. It never throws into that flow, and it reads nothing while
 * no registry provider is named; an instance with none loads nothing new. Whatever a transient failure here
 * leaves behind, the daily sweep (067) ends on its next pass. */
const endMemberConnections = async (companyId, userId) => {
    if (!flag.named().length) return 0;
    const registry = require('../../Connectors/registry');
    if (!registry.list().some((definition) => flag.named().includes(definition.id))) return 0;
    try {
        return await require('../../Connectors/connection').endForMember(companyId, userId);
    } catch (error) {
        logger.error(`[connectors] ending a departed member's connections failed: ${(error && error.name) || 'Error'}`);
        return 0;
    }
};

module.exports = { endMemberConnections };
