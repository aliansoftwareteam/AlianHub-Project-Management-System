const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v2/goals', ctrl.listGoals);
    app.post('/api/v2/goals', ctrl.createGoal);
    app.get('/api/v2/goals/for-task/:taskId', ctrl.goalsForTask);
    app.get('/api/v2/goals/:id', ctrl.getGoal);
    app.patch('/api/v2/goals/:id', ctrl.updateGoal);
    app.post('/api/v2/goals/:id/archive', ctrl.archiveGoal);
    app.post('/api/v2/goals/:id/restore', ctrl.restoreGoal);
    app.post('/api/v2/goals/:id/targets', ctrl.addTarget);
    app.patch('/api/v2/goals/:id/targets/:targetId', ctrl.editTarget);
    app.delete('/api/v2/goals/:id/targets/:targetId', ctrl.removeTarget);
    app.put('/api/v2/goals/:id/targets/:targetId/value', ctrl.setTargetValue);
};
