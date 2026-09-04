/* HTTP 200-on-failure, decided (AR-24).
 *
 * Every handler answers failures with HTTP 200 and { status: false } in the body,
 * and every frontend caller reads that field. Changing the code for everyone is a
 * migration of hundreds of callers. So the convention is kept for the app, and a
 * caller that cares about status codes opts in: an API token or MCP token (agents,
 * integrations, webhooks) gets real 4xx automatically; anything else can ask with
 * `Prefer: status-codes`. The body is never changed, only the status line, and the
 * mapping is announced in X-Status-Mapped so it is visible in any client log. */

// An API token is recognised by its bearer prefix, not by whether some later
// middleware resolved it: on routes outside the JWT guard req.apiToken is never set.
const API_TOKEN_PREFIX = /^Bearer\s+ahp_/i;
const wantsStatusCodes = (req) => Boolean(req.apiToken)
    || API_TOKEN_PREFIX.test(String((req.get && req.get('Authorization')) || (req.headers && req.headers.authorization) || ''))
    || /\bstatus-codes\b/i.test(String((req.get && req.get('Prefer')) || ''));

const inferStatus = (body) => {
    const explicit = Number(body.statusCode || body.code);
    if (explicit >= 400 && explicit <= 599) return explicit;
    const text = String(body.statusText || body.message || '');
    if (/not found|no such|does not exist/i.test(text)) return 404;
    if (/permission|not allowed|forbidden|cannot (perform|create|edit|delete)|only (an )?(owner|admin)|read-only/i.test(text)) return 403;
    if (/already|conflict|duplicate/i.test(text)) return 409;
    if (/token|unauthori[sz]ed|log ?in|session/i.test(text)) return 401;
    return 400;
};

const isFailureBody = (body) => body && typeof body === 'object' && !Array.isArray(body) && body.status === false;

const strictStatus = () => (req, res, next) => {
    const send = res.send.bind(res);
    res.send = (body) => {
        let parsed = body;
        if (typeof body === 'string' && body[0] === '{') { try { parsed = JSON.parse(body); } catch (e) { parsed = null; } }
        if (res.statusCode === 200 && isFailureBody(parsed) && wantsStatusCodes(req)) {
            res.status(inferStatus(parsed));
            res.set('X-Status-Mapped', '1');
        }
        return send(body);
    };
    next();
};

module.exports = { strictStatus, wantsStatusCodes, inferStatus, isFailureBody };
