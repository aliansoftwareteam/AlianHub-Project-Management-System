const controller = require('./controller');
const logger = require('../../Config/loggerConfig');

exports.init = (app) => {
    // Create a personal note.
    app.post('/api/v1/notes', controller.createNote);
    // List the caller's own notes (current company).
    app.get('/api/v1/notes', controller.listMine);
    // Edit a note (title / content) or stamp convertedTaskId after convert-to-task.
    app.patch('/api/v1/notes/:id', controller.updateNote);
    // Soft-delete a note.
    app.delete('/api/v1/notes/:id', controller.deleteNote);
    logger.info('Notes routes initialised');
};
