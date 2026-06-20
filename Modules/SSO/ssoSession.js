const sesstionCtr = require("../Auth/session.js");
const { generateTokenV2Fun } = require("../Auth/controller/authHelpers");
const config = require("../../Config/config");
const serviceCtr = require("../serviceFunction.js");

// SEC-02 — establish a real session for an SSO-authenticated user, then REDIRECT
// the browser back to the app (the IdP flow is a full-page redirect, not an SPA
// fetch). Reuses the exact session/token primitives the password login uses
// (insertSessionFun + generateTokenV2Fun), only the response differs (cookies +
// redirect instead of JSON). SameSite=Lax so the post-IdP top-level navigation
// carries the cookies.
const finalizeSsoSession = (req, res, uid, redirectPath) => {
    const forwarded = req?.headers['x-forwarded-for'] || req.ip;
    const clientIp = forwarded ? forwarded?.split(',')[0] : req?.connection?.remoteAddress;
    const fail = (reason) => res.redirect(`/login?ssoError=${encodeURIComponent(reason)}`);
    sesstionCtr.insertSessionFun({ userId: uid }, req.headers['user-agent'] || '', clientIp, (sData) => {
        if (!(sData && sData.status)) return fail('session');
        generateTokenV2Fun(uid, sData.data.refreshToken, (gData) => {
            if (!(gData && gData.status)) return fail('token');
            const setCookie = {
                httpOnly: false,
                secure: config.NODE_ENV === 'production',
                sameSite: 'Lax',
                domain: process.env.NODE_ENV === 'production' ? req.hostname : undefined,
            };
            res.cookie('refreshToken', sData.data.refreshToken, { ...setCookie, maxAge: Number(process.env.SESSIONEXPIREDTIME || 172800) * 1000 });
            res.cookie('accessToken', gData.token, { ...setCookie, maxAge: serviceCtr.convertToSeconds(process.env.JWT_EXP) * 1000 });
            return res.redirect(redirectPath || '/');
        });
    });
};

module.exports = { finalizeSsoSession };
