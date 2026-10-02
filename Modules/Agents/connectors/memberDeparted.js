const flag = require('./flag');

/* Called wherever a member is removed or deactivated. The connection module is loaded only where a Google
 * connector is named, so the member flows of an instance without connectors load and read nothing new; and
 * nothing here can fail the removal. */
const endMemberConnections = async (companyId, userId) => {
    if (!flag.requestedGoogle().length) return 0;
    try {
        return await require('./googleConnection').memberDeparted(companyId, userId);
    } catch (error) {
        require('../../../Config/loggerConfig').error(`[connectors] ending a departed member's connections failed: ${(error && error.name) || 'Error'}`);
        return 0;
    }
};

module.exports = { endMemberConnections };
