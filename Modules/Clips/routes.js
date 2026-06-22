const controller = require('./controller');
const logger = require('../../Config/loggerConfig');

exports.init = (app) => {
    // Create a clip record (media file already uploaded via the storage endpoint).
    app.post('/api/v1/clips', controller.createClip);
    // List the caller's own clips (current company).
    app.get('/api/v1/clips', controller.listMine);
    // Rename a clip (set title).
    app.patch('/api/v1/clips/:id', controller.updateClip);
    // Soft-delete a clip record.
    app.delete('/api/v1/clips/:id', controller.deleteClip);
    logger.info('Clips routes initialised');
};
