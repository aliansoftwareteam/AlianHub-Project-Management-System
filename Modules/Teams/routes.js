const ctrl = require('./controller');
const { managesTeams } = require('./teamWrites');

exports.init = (app) => {
    app.get('/api/v1/teams',ctrl.getTeams);
    app.post('/api/v1/teams/addTeam', managesTeams('settings.settings_create_team'), ctrl.addTeam);
    app.put('/api/v1/teams/updateTeam', managesTeams('settings.settings_team_list'), ctrl.updateTeam);
}
