const express = require('express');
const ctrl = require('./controller');
const { scimAuth } = require('./auth');

exports.init = (app) => {
    // Admin config — JWT + companyId (listed in setMiddleware); owner/admin
    // gated in-controller. Used by the Settings UI to enable SCIM + mint a token.
    app.get('/api/v2/scim/config', ctrl.getConfig);
    app.put('/api/v2/scim/config', ctrl.setConfig);
    app.post('/api/v2/scim/token', ctrl.rotateToken);

    // SCIM 2.0 protocol — bearer-token auth (company resolved FROM the token), so
    // these are intentionally NOT behind the JWT/companyId middleware. A
    // router-scoped body parser also accepts application/scim+json.
    const scim = express.Router();
    scim.use(express.json({ type: ['application/json', 'application/scim+json'], limit: '1mb' }));
    scim.use(scimAuth);
    scim.get('/ServiceProviderConfig', ctrl.serviceProviderConfig);
    scim.get('/ResourceTypes', ctrl.resourceTypes);
    scim.get('/Schemas', ctrl.schemas);
    scim.get('/Users', ctrl.listUsers);
    scim.post('/Users', ctrl.createUser);
    scim.get('/Users/:id', ctrl.getUser);
    scim.put('/Users/:id', ctrl.replaceUser);
    scim.patch('/Users/:id', ctrl.patchUser);
    scim.delete('/Users/:id', ctrl.deleteUser);
    app.use('/scim/v2', scim);
};
