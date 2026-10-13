const ctrl = require('./controller');
const { agentsRefused } = require('../Agents/guard');

exports.init = (app) => {
    app.post('/api/v1/project/personal', agentsRefused('project.create'), ctrl.getOrCreatePersonalProject);
};
