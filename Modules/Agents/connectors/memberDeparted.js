const logger = require('../../../Config/loggerConfig');

/* Called wherever a member is removed or deactivated, and never throws into that flow. It runs whatever CONNECTORS
 * names now: a provider switched off since still left its tokens and grants behind. Whatever a transient failure
 * here leaves behind, the daily sweep (067) ends on its next pass. */
const endMemberConnections = async (companyId, userId) => {
    try {
        return await require('../../Connectors/connection').endForMember(companyId, userId);
    } catch (error) {
        logger.error(`[connectors] ending a departed member's connections failed: ${(error && error.name) || 'Error'}`);
        return 0;
    }
};

module.exports = { endMemberConnections };
