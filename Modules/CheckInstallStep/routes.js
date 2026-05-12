const ctrl = require('./controller');
const { handleEvents } = require('./eventController');
const createCompanyctrl = require('./createCompany');

exports.init = (app) => {
    //
    ctrl.initDataRoute(app);
    app.post('/api/v1/checkinstallstep', ctrl.checkinstallstep);
    app.get('/api/v1/checkinstallstep/events/:id', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        handleEvents(req, res)
    });

    app.get('/api/v1/installstep/get', ctrl.installstepget);
    app.get('/api/v1/getAiModels', ctrl.getAiModels);
    app.post('/api/v1/installstep/createUserAndCompany', createCompanyctrl.createUserAndCompany);
};