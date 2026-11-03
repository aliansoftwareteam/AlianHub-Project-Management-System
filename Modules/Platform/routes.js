const ctrl = require('./controller');
const auth = require('./authController');
const { requirePlatform } = require('./guard');
const { audited } = require('./platformAudit');

const BASE = '/api/v2/platform';

exports.init = (app) => {
    app.get(`${BASE}/status`, requirePlatform, audited('platform.status', ctrl.status));
    app.post(`${BASE}/provision`, requirePlatform, audited('platform.provision', ctrl.provision));
    app.put(`${BASE}/config`, requirePlatform, audited('platform.config', ctrl.putConfig));
    app.put(`${BASE}/entitlements`, requirePlatform, audited('platform.entitlements', ctrl.putEntitlements));
    app.get(`${BASE}/usage`, requirePlatform, audited('platform.usage', ctrl.usage));
    app.post(`${BASE}/lifecycle`, requirePlatform, audited('platform.lifecycle', ctrl.setLifecycle));
    app.post(`${BASE}/owner/activation-link`, requirePlatform, audited('platform.owner_activation_link', ctrl.activationLink));
    app.post(`${BASE}/owner/login-link`, requirePlatform, audited('platform.owner_login_link', ctrl.loginLink));
    app.post(`${BASE}/owner/transfer`, requirePlatform, audited('platform.owner_transfer', ctrl.transferOwner));
    app.post(`${BASE}/rotate-key`, requirePlatform, audited('platform.rotate_key', ctrl.rotateKey));
    app.post(`${BASE}/support-session`, requirePlatform, audited('platform.support_session', ctrl.startSupportSession));
    app.delete(`${BASE}/support-session`, requirePlatform, audited('platform.support_session_end', ctrl.endSupportSession));

    app.post('/api/v2/auth/platform-login', auth.platformLogin);
    app.post('/api/v2/auth/activation/verify', auth.verifyActivation);
    app.post('/api/v2/auth/activate', auth.activate);
};
