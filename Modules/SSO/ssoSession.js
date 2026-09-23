const sesstionCtr = require("../Auth/session.js");
const { generateTokenV2Fun, sessionRefusalFor } = require("../Auth/controller/authHelpers");
const config = require("../../Config/config");
const logger = require("../../Config/loggerConfig");
const { httpOnlyCookies } = require("../../Config/cookies");
const serviceCtr = require("../serviceFunction.js");
const { requestAddress } = require('../../utils/requestAddress');

// SEC-02 — establish a real session for an SSO-authenticated user, then REDIRECT
// the browser back to the app (the IdP flow is a full-page redirect, not an SPA
// fetch). Reuses the exact session/token primitives the password login uses
// (insertSessionFun + generateTokenV2Fun), only the response differs (cookies +
// redirect instead of JSON). SameSite=Lax so the post-IdP top-level navigation
// carries the cookies.
const finalizeSsoSession = (req, res, uid, redirectPath) => {
    const clientIp = requestAddress(req);
    const fail = (reason) => res.redirect(`/login?ssoError=${encodeURIComponent(reason)}`);
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
                return res.redirect(redirectPath || '/');
            });
        });
    }, (error) => {
        logger.error(`finalizeSsoSession: ${error.message || error}`);
        fail('session');
    });
};

module.exports = { finalizeSsoSession };
