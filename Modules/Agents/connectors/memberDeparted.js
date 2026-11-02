const flag = require('./flag');
const logger = require('../../../Config/loggerConfig');

/* Called wherever a member is removed or deactivated. Neither path throws into that flow, and each reads nothing
 * while its own connectors are not named; an instance with none loads nothing new. Whatever a transient failure
 * here leaves behind, the daily sweep (067) ends on its next pass. */
const endMemberConnections = async (companyId, userId) => {
    let ended = 0;
    if (flag.requestedGoogle().length) {
        try {
            ended += await require('./googleConnection').memberDeparted(companyId, userId);
        } catch (error) {
            logger.error(`[connectors] ending a departed member's Google connections failed: ${(error && error.name) || 'Error'}`);
        }
    }
    if (flag.named().length) {
        const registry = require('../../Connectors/registry');
        if (registry.list().some((definition) => flag.named().includes(definition.id))) {
            try {
                ended += await require('../../Connectors/connection').endForMember(companyId, userId);
            } catch (error) {
                logger.error(`[connectors] ending a departed member's connections failed: ${(error && error.name) || 'Error'}`);
            }
        }
    }
    return ended;
};

module.exports = { endMemberConnections };
