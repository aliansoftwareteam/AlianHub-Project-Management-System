/* The ah_ws cookie tells the tracker's workspace finder (auth.<hint domain>) which hosted
 * workspaces this browser signs in to. It holds subdomain labels only: the finder routes the
 * browser to a workspace, and that workspace signs the person in itself. */

const { isManaged } = require('../../../Config/hostingMode');
const { readCookie } = require('../../../Config/cookies');
const logger = require('../../../Config/loggerConfig');

const COOKIE = 'ah_ws';
const MAX_LABELS = 5;
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

const hintDomain = (env = process.env) => {
    const domain = String(env.WORKSPACE_HINT_DOMAIN || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
    return DOMAIN.test(domain) ? domain : '';
};

/* A workspace one label under the hint domain, on a managed instance; anything else sets no hint. */
const labelFor = (hostname, { env = process.env, managed = false } = {}) => {
    const domain = hintDomain(env);
    if (!managed || !domain) return null;
    const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
    const suffix = `.${domain}`;
    if (!host.endsWith(suffix)) return null;
    const label = host.slice(0, -suffix.length);
    return LABEL.test(label) ? label : null;
};

const parseHint = (value) => {
    const seen = new Set();
    return String(value || '')
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .filter((label) => LABEL.test(label) && !seen.has(label) && seen.add(label))
        .slice(0, MAX_LABELS);
};

const mergeHint = (value, label) => [label, ...parseHint(value).filter((other) => other !== label)].slice(0, MAX_LABELS);

const removeFromHint = (value, label) => parseHint(value).filter((other) => other !== label);

const cookieOptions = (domain, env = process.env) => ({
    domain,
    path: '/',
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
});

/* Never lets a hint problem fail the sign-in or sign-out it rides on. */
const writeHint = (req, res, change, { env = process.env, managed } = {}) => {
    try {
        const label = labelFor(req && req.hostname, { env, managed: managed === undefined ? isManaged() : managed });
        if (!label) return;
        const labels = change(readCookie(req, COOKIE), label);
        const options = cookieOptions(hintDomain(env), env);
        if (labels.length) res.cookie(COOKIE, labels.join(','), { ...options, maxAge: MAX_AGE_MS });
        else res.clearCookie(COOKIE, options);
    } catch (error) {
        logger.warn(`workspace hint: ${error.message || error}`);
    }
};

const rememberWorkspace = (req, res, options) => writeHint(req, res, mergeHint, options);
const forgetWorkspace = (req, res, options) => writeHint(req, res, removeFromHint, options);

module.exports = {
    COOKIE,
    MAX_LABELS,
    MAX_AGE_MS,
    hintDomain,
    labelFor,
    parseHint,
    mergeHint,
    removeFromHint,
    cookieOptions,
    rememberWorkspace,
    forgetWorkspace,
};
