/* A stand-in for Slack's Web API behind safeFetch: every call the server makes lands in `calls` with the header
 * that carried the token and the workspace it was made for. Any other URL is a web fetch and lands in `web`. */

const API = 'https://slack.com/api/';

const create = () => {
    const slack = { calls: [], web: [], answers: {} };

    slack.fetch = async (url, opts = {}) => {
        const target = String(url);
        if (!target.startsWith(API)) {
            slack.web.push(target);
            return { status: 200, headers: {}, body: '<html><head><title>A page</title></head><body>Hello</body></html>', bytes: 64, hops: [] };
        }
        const method = target.slice(API.length);
        const form = Object.fromEntries(new URLSearchParams(opts.data || ''));
        slack.calls.push({
            url: target, method, form, verb: opts.method, redirects: opts.maxRedirects,
            authorization: (opts.headers || {}).Authorization,
            workspace: (require('../../Modules/Agents/engine/egressContext').get() || {}).companyId,
        });
        const answer = slack.answers[method];
        if (answer instanceof Error) throw answer;
        if (!answer) return { status: 200, headers: {}, body: JSON.stringify({ ok: false, error: 'unknown_method' }), bytes: 0, hops: [] };
        const { status = 200, headers = {}, body } = typeof answer === 'function' ? answer(form) : answer;
        return { status, headers, body: typeof body === 'string' ? body : JSON.stringify(body), bytes: 0, hops: [] };
    };

    slack.reset = (answers = {}) => {
        slack.calls.length = 0;
        slack.web.length = 0;
        slack.answers = answers;
    };

    slack.methods = () => slack.calls.map((c) => c.method);

    return slack;
};

module.exports = { create };
