const agentFetch = require('../engine/agentFetch');
const egressContext = require('../engine/egressContext');

const API = 'https://slack.com/api/';
const HOST = 'slack.com';
const METHODS = Object.freeze(['auth.test', 'conversations.list', 'conversations.info', 'conversations.history', 'chat.postMessage']);
const TIMEOUT_MS = 8000;
const MAX_BYTES = 512 * 1024;
const ERROR_CODE = /^[a-z0-9_]{1,60}$/;
const TOKEN_ERRORS = Object.freeze(['invalid_auth', 'token_revoked', 'token_expired', 'account_inactive', 'not_authed']);

const ERROR = Object.freeze({ UNREACHABLE: 'unreachable', RATE_LIMITED: 'rate_limited', BAD_RESPONSE: 'bad_response', UNKNOWN: 'unknown_error' });

const scrub = (text, token) => (token ? String(text || '').split(String(token)).join('[token]') : String(text || ''));

const secondsOf = (value) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 3600) : null; };

const isTokenError = (code) => TOKEN_ERRORS.includes(String(code || ''));

/* One attempt, never a retry: a refused token or a rate limit is answered to the caller, who decides. */
const call = async ({ companyId, actor, token, method, args = {} }) => {
    if (!METHODS.includes(method)) throw new Error(`slack: ${method} is not a method this connector calls`);
    let res;
    try {
        res = await egressContext.run(
            { companyId: String(companyId), actor: String(actor || '') },
            () => agentFetch.callProvider(`${API}${method}`, { form: args, token, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES }),
        );
    } catch (e) {
        return { ok: false, error: ERROR.UNREACHABLE, detail: scrub(e && e.message, token).slice(0, 300) };
    }
    if (res.status === 429) return { ok: false, error: ERROR.RATE_LIMITED, retryAfter: secondsOf(res.headers['retry-after']) };
    if (res.status < 200 || res.status >= 300) return { ok: false, error: `http_${res.status}` };
    let body;
    try { body = JSON.parse(res.body); } catch (e) { return { ok: false, error: ERROR.BAD_RESPONSE }; }
    if (!body || body.ok !== true) {
        const code = body && ERROR_CODE.test(String(body.error || '')) ? String(body.error) : ERROR.UNKNOWN;
        return { ok: false, error: code === 'ratelimited' ? ERROR.RATE_LIMITED : code };
    }
    return { ok: true, body };
};

module.exports = { HOST, METHODS, ERROR, TOKEN_ERRORS, isTokenError, call };
