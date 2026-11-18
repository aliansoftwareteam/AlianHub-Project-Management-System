/* Stands in for Microsoft behind safeFetch: the identity platform's token endpoint and the Graph calls the Outlook
 * tools make. Like Graph it refuses a call without a token it issued (or TOKEN, for tests that skip the sign-in) and
 * answers an error as { error: { code } };
 * it keeps drafts and events, and records anything that would send mail in `sent`, which a test expects to stay
 * empty. Every token is random and made here, never a real one. */

const crypto = require('crypto');

const LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0/';
const GRAPH = 'https://graph.microsoft.com/';
const ME = '/v1.0/me';
const TOKEN = 'graph-test-token';
const ACCESS_PREFIX = 'eyJ0.access.';
const TENANT = '72f988bf-0000-4000-8000-0000000000c1';
const OID = '00000000-0000-4000-8000-0000000000a1';

const random = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const answer = (status, body = {}, headers = {}) => ({ status, headers, body: typeof body === 'string' ? body : JSON.stringify(body), bytes: 0, hops: [] });
const graphError = (status, code) => answer(status, { error: { code, message: code } });
const who = (name, address) => ({ emailAddress: { name, address } });

const ME_PERSON = who('Prisha Shah', 'prisha@contoso.test');
const ANA = who('Ana Silva', 'ana@contoso.test');
const SAM = who('Sam Lee', 'sam@contoso.test');

const BUDGET_HTML = [
    '<html><head><title>x</title><style>p { color: red }</style></head><body>',
    '<p>Hi Prisha,</p><p>Can we move the <b>budget</b> review to Friday?<br>Costs are up 5% &amp; travel &lt;&gt; plan.</p>',
    '<!-- tracking --><script>alert(1)</script>',
    '<a href="https://track.example/click"><img src="https://track.example/pixel.png"></a>',
    '<p>Thanks,&nbsp;Ana&#33;</p></body></html>',
].join('');

const messages = () => [
    {
        id: 'AAMk-budget_1=', folder: 'inbox', subject: 'Budget review', from: ANA, toRecipients: [ME_PERSON], ccRecipients: [SAM],
        receivedDateTime: '2026-11-10T09:30:00Z', isRead: false, hasAttachments: true,
        bodyPreview: 'Hi Prisha, Can we move the budget review to Friday?', body: { contentType: 'html', content: BUDGET_HTML },
        webLink: 'https://outlook.office365.com/owa/?ItemID=AAMk-budget_1%3D',
    },
    {
        id: 'AAMk-lunch_2', folder: 'inbox', subject: 'Lunch?', from: SAM, toRecipients: [ME_PERSON], ccRecipients: [],
        receivedDateTime: '2026-11-09T12:00:00Z', isRead: true, hasAttachments: false,
        bodyPreview: 'Lunch on Thursday?', body: { contentType: 'text', content: 'Lunch on Thursday?\r\nSam' },
        webLink: 'https://outlook.office365.com/owa/?ItemID=AAMk-lunch_2',
    },
    {
        id: 'AAMk-sent_3', folder: 'sentitems', subject: 'Offsite budget', from: ME_PERSON, toRecipients: [ANA], ccRecipients: [],
        receivedDateTime: '2026-11-08T08:00:00Z', isRead: true, hasAttachments: false,
        bodyPreview: 'Here is the offsite budget.', body: { contentType: 'text', content: 'Here is the offsite budget.' },
        webLink: 'https://outlook.office365.com/owa/?ItemID=AAMk-sent_3',
    },
];

const events = () => [
    {
        id: 'AAMkEv1=', subject: 'Standup', isAllDay: false, isCancelled: false,
        start: { dateTime: '2026-11-12T09:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-12T09:15:00.0000000', timeZone: 'UTC' },
        location: { displayName: 'Room 4' }, organizer: ANA, bodyPreview: 'Daily standup', webLink: 'https://outlook.office365.com/calendar/item/AAMkEv1',
    },
    {
        id: 'AAMkEv2=', subject: 'Offsite', isAllDay: true, isCancelled: false,
        start: { dateTime: '2026-11-13T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-15T00:00:00.0000000', timeZone: 'UTC' },
        location: { displayName: '' }, organizer: ME_PERSON, bodyPreview: '', webLink: 'https://outlook.office365.com/calendar/item/AAMkEv2',
    },
    {
        id: 'AAMkEv3=', subject: 'Vendor call', isAllDay: false, isCancelled: true,
        start: { dateTime: '2026-11-12T15:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-12T15:30:00.0000000', timeZone: 'UTC' },
        location: { displayName: 'Teams' }, organizer: SAM, bodyPreview: 'Quarterly check-in', webLink: 'https://outlook.office365.com/calendar/item/AAMkEv3',
    },
];

const at = (moment) => new Date(`${String(moment.dateTime).slice(0, 19)}Z`).getTime();

const create = ({ clientId = 'outlook-client', clientSecret = 'outlook-secret' } = {}) => {
    const state = { messages: messages(), events: events(), drafts: [], sent: [], calls: [], web: [], next: null };
    const identity = { calls: [], codes: new Map(), grants: new Map(), issued: [] };

    const top = (q) => Number(q.get('$top')) || undefined;

    const search = (q) => {
        const words = String(q.get('$search') || '').replace(/"/g, ' ').toLowerCase().split(/\s+/).filter(Boolean);
        const hay = (m) => [m.subject, m.bodyPreview, m.from.emailAddress.name, m.from.emailAddress.address].join(' ').toLowerCase();
        const found = state.messages.filter((m) => words.every((word) => hay(m).includes(word)));
        return answer(200, { value: found.sort((a, b) => b.receivedDateTime.localeCompare(a.receivedDateTime)).slice(0, top(q)) });
    };

    const inbox = (q) => {
        const found = state.messages.filter((m) => m.folder === 'inbox').sort((a, b) => b.receivedDateTime.localeCompare(a.receivedDateTime));
        return answer(200, { value: found.slice(0, top(q)) });
    };

    const calendarView = (q) => {
        const from = new Date(q.get('startDateTime')).getTime();
        const to = new Date(q.get('endDateTime')).getTime();
        if (!Number.isFinite(from) || !Number.isFinite(to)) return graphError(400, 'ErrorInvalidParameter');
        const found = state.events.filter((e) => at(e.start) < to && at(e.end) > from).sort((a, b) => at(a.start) - at(b.start));
        return answer(200, { value: found.slice(0, top(q)) });
    };

    const reply = (message, all, body) => {
        const to = all ? [message.from, ...message.toRecipients, ...message.ccRecipients].filter((r) => r.emailAddress.address !== ME_PERSON.emailAddress.address) : [message.from];
        const draft = {
            id: `AAMkDraft${state.drafts.length + 1}=`, isDraft: true, subject: `RE: ${message.subject}`, toRecipients: to, replyTo: message.id,
            comment: body.comment, body: { contentType: 'html', content: `${body.comment}<hr>${message.body.content}` },
            webLink: `https://outlook.office365.com/owa/?ItemID=AAMkDraft${state.drafts.length + 1}`,
        };
        state.drafts.push(draft);
        return answer(201, draft);
    };

    const createEvent = (body) => {
        const made = { ...body, id: `AAMkEv${state.events.length + 1}=`, webLink: `https://outlook.office365.com/calendar/item/AAMkEv${state.events.length + 1}` };
        state.events.push(made);
        return answer(201, made);
    };

    const route = (url, method, body) => {
        const path = url.pathname;
        const q = url.searchParams;
        if (path === `${ME}/sendMail` || /\/send$/.test(path)) { state.sent.push({ path, body }); return answer(202, ''); }
        if (method === 'get' && path === `${ME}/messages`) return search(q);
        if (method === 'get' && path === `${ME}/mailFolders/inbox/messages`) return inbox(q);
        if (method === 'get' && path === `${ME}/calendarView`) return calendarView(q);
        if (method === 'post' && path === `${ME}/events`) return createEvent(body);
        const one = path.match(/^\/v1\.0\/me\/messages\/([^/]+)(?:\/(createReply|createReplyAll))?$/);
        if (one) {
            const message = state.messages.find((m) => m.id === decodeURIComponent(one[1]));
            if (!message) return graphError(404, 'ErrorItemNotFound');
            if (!one[2] && method === 'get') return answer(200, message);
            if (one[2] && method === 'post') return reply(message, one[2] === 'createReplyAll', body || {});
        }
        return graphError(400, 'BadRequest');
    };

    const graph = (target, options) => {
        const url = new URL(target);
        const method = String(options.method || 'get').toLowerCase();
        const body = options.data ? JSON.parse(options.data) : undefined;
        state.calls.push({ url, method, body });
        const accepted = [TOKEN, ...identity.issued.filter((t) => t.startsWith(ACCESS_PREFIX))].map((t) => `Bearer ${t}`);
        if (!accepted.includes((options.headers || {}).Authorization)) return graphError(401, 'InvalidAuthenticationToken');
        if (state.next) { const planned = state.next; state.next = null; return planned; }
        return route(url, method, body);
    };

    const issue = (prefix) => {
        const token = `${prefix}${random()}`;
        identity.issued.push(token);
        return token;
    };

    /* Plays the person signing in and consenting; `granted` is the scope string Microsoft answers with. */
    identity.consent = (authUrl, { granted, tid = TENANT, oid = OID, username = 'prisha@contoso.test' } = {}) => {
        const url = new URL(authUrl);
        if (`${url.origin}${url.pathname}` !== `${LOGIN}authorize`) throw new Error(`fake Microsoft: ${url.origin}${url.pathname} is not the authorize address`);
        const asked = Object.fromEntries(url.searchParams);
        const code = `M.C5_${random()}`;
        identity.codes.set(code, { asked, granted: granted === undefined ? asked.scope : granted, tid, oid, username });
        return { code, state: asked.state, asked };
    };

    const idToken = (grant) => {
        const token = [part({ typ: 'JWT', alg: 'RS256' }), part({ tid: grant.tid, oid: grant.oid, sub: random(8), preferred_username: grant.username, name: 'Prisha Shah' }), random(16)].join('.');
        identity.issued.push(token);
        return token;
    };

    const tokens = (grant) => ({
        token_type: 'Bearer', expires_in: 3599, scope: grant.granted, access_token: issue(ACCESS_PREFIX),
        ...(grant.asked.scope.split(' ').includes('offline_access') ? { refresh_token: issue('M.R3_') } : {}),
    });

    const exchange = (form) => {
        const grant = identity.codes.get(form.code);
        identity.codes.delete(form.code);
        if (!grant || grant.asked.client_id !== form.client_id || grant.asked.redirect_uri !== form.redirect_uri) return answer(400, { error: 'invalid_grant', error_codes: [70000] });
        const verified = grant.asked.code_challenge_method === 'S256' && form.code_verifier
            && crypto.createHash('sha256').update(form.code_verifier).digest('base64url') === grant.asked.code_challenge;
        if (!verified) return answer(400, { error: 'invalid_grant', error_codes: [501481] });
        const out = tokens(grant);
        if (out.refresh_token) identity.grants.set(out.refresh_token, { ...grant, dead: '' });
        return answer(200, { ...out, ...(grant.asked.scope.split(' ').includes('openid') ? { id_token: idToken(grant) } : {}) });
    };

    const refreshed = (form) => {
        const grant = identity.grants.get(form.refresh_token);
        if (!grant) return answer(400, { error: 'invalid_grant', error_codes: [9002313] });
        if (grant.dead) return answer(400, { error: grant.dead, error_codes: [50076] });
        const out = tokens(grant);
        identity.grants.set(out.refresh_token, grant);
        return answer(200, out);
    };

    const token = (options) => {
        const form = Object.fromEntries(new URLSearchParams(options.data || ''));
        identity.calls.push({ form, authorization: (options.headers || {}).Authorization });
        if (form.client_id !== clientId || form.client_secret !== clientSecret) return answer(401, { error: 'invalid_client', error_codes: [7000215] });
        if (form.grant_type === 'authorization_code') return exchange(form);
        if (form.grant_type === 'refresh_token') return refreshed(form);
        return answer(400, { error: 'unsupported_grant_type' });
    };

    const fetch = async (target, options = {}) => {
        const url = String(target);
        if (url === `${LOGIN}token`) return token(options);
        if (url.startsWith(GRAPH)) return graph(url, options);
        state.web.push(url);
        return answer(200, '<html><head><title>A page</title></head><body>Hello</body></html>');
    };

    return { state, identity, fetch, TOKEN };
};

module.exports = { create, answer, graphError, TOKEN, TENANT, OID };
