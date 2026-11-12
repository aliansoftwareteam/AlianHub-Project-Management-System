const sesstionCtr = require("../Auth/session.js");
const { generateTokenV2Fun, sessionRefusalFor } = require("../Auth/controller/authHelpers");
const config = require("../../Config/config");
const logger = require("../../Config/loggerConfig");
const { httpOnlyCookies } = require("../../Config/cookies");
const serviceCtr = require("../serviceFunction.js");
const { requestAddress } = require('../../utils/requestAddress');
const workspaceHint = require('../Auth/helpers/workspaceHint');
const { sameOriginPath } = require('../Auth/helpers/sameOriginPath');

/* The SPA routes on the hash, so a path or query outside it never reaches the sign-in page. */
const ssoLoginPage = (query) => `${String(config.WEBURL || '').replace(/\/+$/, '')}/#/login?${query}`;

const ssoFailed = (res, reason) => res.redirect(ssoLoginPage(`ssoError=${encodeURIComponent(reason)}`));

const signedInQuery = (uid, companyId, redirect) => {
    const query = new URLSearchParams({ sso: 'ok', uid: String(uid), workspace: String(companyId) });
    const back = sameOriginPath(redirect);
    if (back) query.set('redirect_url', back);
    return query.toString();
};

/* Lands on the sign-in page because only it records who signed in for the SPA. Lax cookies, because the
 * IdP's redirect back here is a cross-site navigation. */
const finalizeSsoSession = (req, res, uid, companyId, redirect = '') => {
    const clientIp = requestAddress(req);
    const fail = (reason) => ssoFailed(res, reason);
    sessionRefusalFor(uid).then((refusal) => {
        if (refusal) return fail('token');
        sesstionCtr.insertSessionFun({ userId: uid }, req.headers['user-agent'] || '', clientIp, (sData) => {
            if (!(sData && sData.status)) return fail('session');
            generateTokenV2Fun(uid, sData.data.refreshToken, (gData) => {
                if (!(gData && gData.status)) return fail('token');
                const setCookie = {
                    httpOnly: httpOnlyCookies(),
                    secure: config.NODE_ENV === 'production',
                    sameSite: 'Lax',
                    domain: process.env.NODE_ENV === 'production' ? req.hostname : undefined,
                };
                res.cookie('refreshToken', sData.data.refreshToken, { ...setCookie, maxAge: Number(process.env.SESSIONEXPIREDTIME || 172800) * 1000 });
                res.cookie('accessToken', gData.token, { ...setCookie, maxAge: serviceCtr.convertToSeconds(process.env.JWT_EXP) * 1000 });
                workspaceHint.rememberWorkspace(req, res);
                return res.redirect(ssoLoginPage(signedInQuery(uid, companyId, redirect)));
            });
        });
    }, (error) => {
        logger.error(`finalizeSsoSession: ${error.message || error}`);
        fail('session');
    });
};

module.exports = { finalizeSsoSession, ssoFailed };
