const socketEmitter = require('../../../event/socketEventEmitter');
const logger = require('../../../Config/loggerConfig');

/* Every page write announces itself here, with its company: a page row carries no company
 * id, and the knowledge indexer ingests pages from these emits. A delete lists every page it
 * took in `ids`. */
const emitPageChange = (companyId, type, data) => {
    try {
        socketEmitter.emit(type, { type, data, module: 'pages', companyId: String(companyId) });
    } catch (error) {
        logger.error(`ERROR emitting page ${type}: ${error.message}`);
    }
};

module.exports = { emitPageChange };
