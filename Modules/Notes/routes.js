const controller = require('./controller');
const logger = require('../../Config/loggerConfig');

exports.init = (app) => {
    app.post('/api/v1/notes', controller.createNote);
    app.get('/api/v1/notes', controller.listMine);
    app.patch('/api/v1/notes/:id', controller.updateNote);
    app.delete('/api/v1/notes/:id', controller.deleteNote);
    logger.info('Notes routes initialised');
};
