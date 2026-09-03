const axios = require('axios');

// Deterministic static-HTML audit — the EVIDENCE layer.
//
// Everything here is a measured fact with a location, never an opinion. The LLM
// downstream may prioritise, group and word these; it may not invent a finding
// that has no fact under it (see verifier.js). That inversion — facts from code,
// judgement from the model — is what keeps an agent from filing ten confident
// wrong P1s in its first week.
//
// Fetch-only by design: the server has axios and no browser. That means anything
// requiring layout or JS execution (tap-target size, CLS, console errors) is out
// of scope and is reported as a known blind spot rather than silently skipped.

const TIMEOUT_MS = 15000;
const MAX_BYTES = 3 * 1024 * 1024;
const UA = 'AlianHub-QA-Agent/1.0 (+https://alianhub.com)';

/* Block anything that is not a public http(s) host. An agent that follows a URL
 * out of a task description is a request forgery primitive if it can be pointed
 * at localhost or a metadata endpoint. */
const PRIVATE_HOST = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?$|172\.(1[6-9]|2\d|3[01])\.)/i;

const extractUrl = (text) => {
    if (!text) return null;
    const m = String(text).match(/https?:\/\/[^\s<>"')]+/i)
        || String(text).match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})(\/[^\s<>"')]*)?/i);
    if (!m) return null;
    const raw = m[0].startsWith('http') ? m[0] : `https://${m[0]}`;
    try {
        const u = new URL(raw);
        if (!/^https?:$/.test(u.protocol)) return null;
        if (PRIVATE_HOST.test(u.hostname)) return null;
        return u.toString();
    } catch { return null; }
};

const attrs = (tag) => {
    const out = {};
    const re = /([a-zA-Z_:][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let m;
    while ((m = re.exec(tag)) !== null) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
    return out;
};
const tagsOf = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];

async function fetchPage(url) {
    const res = await axios.get(url, {
        timeout: TIMEOUT_MS,
        maxContentLength: MAX_BYTES,
        maxRedirects: 5,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
        validateStatus: () => true,
        responseType: 'text',
    });
    return { status: res.status, html: typeof res.data === 'string' ? res.data : '', bytes: Buffer.byteLength(String(res.data || '')) };
}

/* Each check returns a fact: { id, ok, detail, evidence }. `evidence` is what the
 * finding will quote, so it has to be concrete enough to act on without re-running. */
function auditHtml(html, url) {
    const facts = [];
    const add = (id, ok, detail, evidence) => facts.push({ id, ok, detail, evidence: evidence ?? null });

    const head = (html.match(/<head[\s\S]*?<\/head>/i) || [''])[0];
    const metas = tagsOf(head, 'meta').map(attrs);
    const meta = (key, val) => metas.find((m) => (m.name || m.property || '').toLowerCase() === val);

    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || '';
    add('title', !!title && title.length <= 60,
        title ? `<title> is ${title.length} chars` : 'no <title>',
        title ? `"${title}"` : null);

    const desc = meta('meta', 'description')?.content || '';
    add('meta_description', !!desc && desc.length <= 160,
        desc ? `meta description is ${desc.length} chars (search engines truncate near 160)` : 'no meta description',
        desc ? `"${desc.slice(0, 90)}…"` : null);

    const ogImage = meta('meta', 'og:image')?.content || '';
    const twCard = meta('meta', 'twitter:card')?.content || '';
    const twImage = meta('meta', 'twitter:image')?.content || '';
    add('og_image', !!ogImage,
        ogImage ? 'og:image present' : 'og:image missing — social shares render with no image',
        twCard ? `twitter:card="${twCard}"${twImage ? '' : ' but twitter:image is also missing'}` : null);

    add('canonical', /<link[^>]+rel=["']?canonical/i.test(head), 
        /<link[^>]+rel=["']?canonical/i.test(head) ? 'canonical present' : 'no canonical link', null);

    const h1s = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi) || [];
    add('h1', h1s.length === 1, `${h1s.length} <h1> on the page`,
        h1s[0] ? h1s[0].replace(/<[^>]+>/g, '').trim().slice(0, 70) : null);

    const imgs = tagsOf(html, 'img').map(attrs);
    const noAlt = imgs.filter((i) => i.alt === undefined);
    add('img_alt', noAlt.length === 0, `${noAlt.length} of ${imgs.length} <img> have no alt attribute`,
        noAlt.slice(0, 3).map((i) => (i.src || '').split('/').pop()).join(', ') || null);

    const noDims = imgs.filter((i) => !i.width || !i.height);
    add('img_dimensions', noDims.length === 0,
        `${noDims.length} of ${imgs.length} <img> lack width/height (causes layout shift)`,
        noDims.slice(0, 3).map((i) => (i.src || '').split('/').pop().split('?')[0]).join(', ') || null);

    const anchors = tagsOf(html, 'a').map(attrs);
    const dead = anchors.filter((a) => !a.href || a.href === '#');
    add('empty_links', dead.length === 0, `${dead.length} of ${anchors.length} <a> have no usable href`, null);

    const blank = anchors.filter((a) => a.target === '_blank' && !/noopener|noreferrer/i.test(a.rel || ''));
    add('blank_noopener', blank.length === 0,
        `${blank.length} links open in a new tab without rel="noopener"`,
        blank.slice(0, 3).map((a) => a.href).join(', ') || null);

    const ldTypes = [];
    (html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || []).forEach((block) => {
        const body = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
        try {
            const j = JSON.parse(body);
            (Array.isArray(j) ? j : [j]).forEach((x) => x && x['@type'] && ldTypes.push(x['@type']));
        } catch { ldTypes.push('PARSE_ERROR'); }
    });
    add('structured_data', ldTypes.length > 0, ldTypes.length ? `structured data: ${ldTypes.join(', ')}` : 'no JSON-LD structured data',
        ldTypes.join(', ') || null);
    add('product_schema', ldTypes.some((t) => /Product|ItemList|Offer/i.test(t)),
        ldTypes.some((t) => /Product|ItemList/i.test(t)) ? 'product schema present' : 'no Product/ItemList schema',
        ldTypes.join(', ') || null);

    add('viewport', /name=["']?viewport/i.test(head), /name=["']?viewport/i.test(head) ? 'viewport meta present' : 'no viewport meta — page will not adapt on mobile', null);
    const lang = (html.match(/<html[^>]*\blang=["']?([\w-]+)/i) || [])[1];
    add('html_lang', !!lang, lang ? `lang="${lang}"` : 'no lang attribute on <html>', null);

    const scripts = tagsOf(html, 'script').map(attrs).filter((s) => s.src);
    add('script_count', scripts.length <= 25, `${scripts.length} external <script> tags in the HTML`, null);

    return facts;
}

/* Checks a fetch-only agent structurally cannot make. Reported so a reviewer knows
 * the shape of what was NOT looked at, rather than reading a clean report as
 * "everything is fine". */
const BLIND_SPOTS = Object.freeze([
    'rendered layout and responsive behaviour (needs a browser)',
    'tap-target sizes and visual overlap',
    'Cumulative Layout Shift and paint timings (LCP/FCP)',
    'JavaScript console errors',
    'anything rendered client-side after load',
]);

async function audit(url) {
    const page = await fetchPage(url);
    if (page.status >= 400) {
        return { url, ok: false, status: page.status, facts: [], blindSpots: BLIND_SPOTS,
                 fatal: `the page returned HTTP ${page.status}` };
    }
    if (!/<html/i.test(page.html)) {
        return { url, ok: false, status: page.status, facts: [], blindSpots: BLIND_SPOTS,
                 fatal: 'the response was not HTML' };
    }
    return { url, ok: true, status: page.status, bytes: page.bytes,
             facts: auditHtml(page.html, url), blindSpots: BLIND_SPOTS };
}

module.exports = { audit, auditHtml, extractUrl, fetchPage, BLIND_SPOTS, PRIVATE_HOST };
