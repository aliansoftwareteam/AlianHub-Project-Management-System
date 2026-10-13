const controller = require('./controller');
const logger = require('../../Config/loggerConfig');

exports.init = (app) => {
    app.post('/api/v1/clips', controller.createClip);
    app.get('/api/v1/clips', controller.listMine);
    app.patch('/api/v1/clips/:id', controller.updateClip);
    app.delete('/api/v1/clips/:id', controller.deleteClip);
    logger.info('Clips routes initialised');
};
