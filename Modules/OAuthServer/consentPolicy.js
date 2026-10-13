const csp = require('../../Config/contentSecurityPolicy');

const SELF = "'self'";
const NONE = "'none'";

const serialize = (directives) => Object.entries(directives).map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');

/* A source expression may carry a path but no query, and a ; or , in it would end the source list. */
const sourceOf = (redirectUri) => {
    const url = new URL(redirectUri);
    return `${url.origin}${url.pathname.replace(/[;,]/g, (c) => encodeURIComponent(c))}`;
};

/* Chrome checks form-action against every redirect that follows a form post, so the app's form-action 'self'
 * would stop the browser on its way back to the client. This page names the one redirect URI the request was
 * validated for, and is never framed (clickjacking the approve button). Under an enforced app policy the rest
 * of it stays; otherwise these directives are sent alone, enforced whatever CSP_MODE says. */
const pagePolicy = (redirectUri, env = process.env, { reportingApi = false } = {}) => {
    const own = { 'form-action': [SELF, sourceOf(redirectUri)], 'frame-ancestors': [NONE] };
    if (csp.modeOf(env) === csp.ENFORCE) return serialize({ ...csp.buildDirectives(env, { reportingApi }), ...own });
    return serialize({ ...own, 'base-uri': [SELF], 'object-src': [NONE] });
};

const REFUSAL_POLICY = serialize({ 'default-src': [NONE], 'form-action': [NONE], 'frame-ancestors': [NONE], 'base-uri': [NONE] });

module.exports = { pagePolicy, sourceOf, REFUSAL_POLICY };
