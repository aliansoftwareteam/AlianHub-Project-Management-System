const routes = require('./routes');
const logger = require('../../Config/loggerConfig');

exports.init = (app) => {
    routes.init(app);
    logger.info('Cloud storage routes initialised');
};
