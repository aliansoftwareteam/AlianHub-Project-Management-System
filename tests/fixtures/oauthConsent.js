/* Drives the real consent endpoints the way a browser does: /oauth/authorize answers a redirect to the consent
 * page and a CSRF cookie bound to that request; the page's form posts the request, the token and the choice
 * back with the cookie and the person's session cookie. Nothing here reaches around the server. */

const form = (body) => new URLSearchParams(Object.entries(body).filter(([, v]) => v !== undefined)).toString();

const cookieFrom = (res) => {
    const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    const line = all.find((value) => /^ahoauth_[A-Za-z0-9_-]+=/.test(value));
    if (!line) return null;
    const [pair, ...attributes] = line.split(';').map((part) => part.trim());
    const at = pair.indexOf('=');
    return { name: pair.slice(0, at), value: pair.slice(at + 1), attributes, line };
};

const readJson = async (res) => {
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch (error) { return text; }
};

/* Answers the authorize response as it came, and when it went to the consent page, what is needed to answer it. */
async function startAuthorization(url, headers = {}) {
    const res = await fetch(url, { redirect: 'manual', headers });
    const raw = res.headers.get('location');
    const location = raw ? new URL(raw, url) : null;
    const pending = location && location.pathname === '/oauth/consent' && location.origin === new URL(url).origin;
    if (!pending) return { status: res.status, location, body: location ? null : await readJson(res), consent: null };
    return { status: res.status, location, body: null, consent: { request: location.searchParams.get('request'), cookie: cookieFrom(res), origin: location.origin, location } };
}

const cookieHeader = (consent, session) => [consent && consent.cookie ? `${consent.cookie.name}=${consent.cookie.value}` : '', session || ''].filter(Boolean).join('; ');

async function details(consent, { session, headers = {} } = {}) {
    const res = await fetch(`${consent.origin}/oauth/consent/details?request=${encodeURIComponent(consent.request)}`, {
        headers: { accept: 'application/json', cookie: cookieHeader(consent, session), ...headers },
    });
    return { status: res.status, body: await readJson(res) };
}

async function answer(consent, { session, decision = 'approve', workspace, csrf, request, headers = {}, cookie } = {}) {
    const res = await fetch(`${consent.origin}/oauth/consent`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie === undefined ? cookieHeader(consent, session) : cookie, ...headers },
        body: form({
            request: request === undefined ? consent.request : request,
            csrf: csrf === undefined ? (consent.cookie && consent.cookie.value) : csrf,
            decision,
            workspace,
        }),
    });
    const raw = res.headers.get('location');
    return { status: res.status, location: raw ? new URL(raw, consent.origin) : null, body: raw ? null : await readJson(res) };
}

async function requestApproval(consent, { session, workspace, csrf, headers = {} } = {}) {
    const res = await fetch(`${consent.origin}/oauth/consent/approval-request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', cookie: cookieHeader(consent, session), ...headers },
        body: JSON.stringify({ request: consent.request, csrf: csrf === undefined ? (consent.cookie && consent.cookie.value) : csrf, workspace }),
    });
    return { status: res.status, body: await readJson(res) };
}

/* The whole browser round: authorize, then answer on the consent page. Answers the final redirect. */
async function consentThrough(url, { session, workspace, decision = 'approve', headers = {} } = {}) {
    const started = await startAuthorization(url);
    if (!started.consent) return started;
    return answer(started.consent, { session, workspace, decision, headers });
}

module.exports = { form, cookieFrom, startAuthorization, details, answer, requestApproval, consentThrough };
