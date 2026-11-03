const TOKEN = 'xoxe.xoxp-slack-test-token';

const answer = (status, body = {}, headers = {}) => ({ status, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const slackError = (error) => answer(200, { ok: false, error });

const NOW = Math.floor(Date.now() / 1000);

/* Stands in for Slack's Web API behind safeFetch. Like Slack, it answers a refusal with 200 and `ok: false`, and lists
 * a private channel only to its members (`#leads` here). */
const create = () => {
    const state = {
        channels: [
            { id: 'C0GENERAL1', name: 'general', is_channel: true, is_private: false, is_member: true },
            { id: 'C0RELEASE1', name: 'releases', is_channel: true, is_private: false, is_member: false },
            { id: 'G0LEADS001', name: 'leads', is_channel: true, is_group: true, is_private: true, is_member: true },
        ],
        ims: [{ id: 'D0DIRECT01', is_im: true, user: 'U0SAM00001' }],
        messages: {
            C0GENERAL1: [
                { type: 'message', user: 'U0SAM00001', text: 'Shipping <!here> today, see <https://x.test|the plan>', ts: String(NOW - 60) },
                { type: 'message', user: 'U0JO000001', text: 'Who owns <#C0RELEASE1|releases>?', ts: String(NOW - 120) },
                { type: 'message', subtype: 'channel_join', user: 'U0NEW00001', text: 'joined', ts: String(NOW - 180) },
            ],
            G0LEADS001: [{ type: 'message', user: 'U0SAM00001', text: 'Budget is approved', ts: String(NOW - 60) }],
            D0DIRECT01: [{ type: 'message', user: 'U0SAM00001', text: 'secret', ts: String(NOW - 60) }],
        },
        posted: [],
        calls: [],
        next: null,
    };

    const info = (id) => {
        const found = [...state.channels, ...state.ims].find((c) => c.id === id);
        return found ? answer(200, { ok: true, channel: found }) : slackError('channel_not_found');
    };

    const route = (url, method, body) => {
        const slackMethod = url.pathname.replace(/^\/api\//, '');
        const q = url.searchParams;
        if (slackMethod === 'conversations.list') return answer(200, { ok: true, channels: state.channels, response_metadata: { next_cursor: '' } });
        if (slackMethod === 'conversations.info') return info(q.get('channel'));
        if (slackMethod === 'conversations.history') {
            const list = state.messages[q.get('channel')];
            if (!list) return slackError('channel_not_found');
            const oldest = Number(q.get('oldest') || 0);
            return answer(200, { ok: true, messages: list.filter((m) => Number(m.ts) > oldest).slice(0, Number(q.get('limit')) || undefined), has_more: false });
        }
        if (slackMethod === 'chat.postMessage' && method === 'post') {
            const ts = `${NOW}.000${state.posted.length + 1}`;
            state.posted.push({ ...body, ts });
            return answer(200, { ok: true, channel: body.channel, ts });
        }
        return slackError('unknown_method');
    };

    const fetch = async (target, options = {}) => {
        const url = new URL(target);
        const method = String(options.method || 'get').toLowerCase();
        const body = options.data ? JSON.parse(options.data) : undefined;
        state.calls.push({ url, method, body });
        if ((options.headers || {}).Authorization !== `Bearer ${TOKEN}`) return slackError('invalid_auth');
        if (state.next) { const planned = state.next; state.next = null; return planned; }
        return route(url, method, body);
    };

    return { state, fetch, TOKEN };
};

module.exports = { create, answer, slackError, TOKEN };
