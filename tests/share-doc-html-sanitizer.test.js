const rules = require('../Modules/PublicShares/helpers/shareRules');

const { sanitizeDocHtml, isObjectIdString, validateCreateShare, validateIntakeSubmission, ENTITY_TYPES } = rules;

describe('sanitizeDocHtml: what a reader keeps', () => {
    it('keeps ordinary formatting', () => {
        const html = '<h1>Plan</h1><p>Some <strong>bold</strong> and <em>italic</em></p><ul><li>one</li></ul>';
        expect(sanitizeDocHtml(html)).toBe(html);
    });

    it('keeps tables and code', () => {
        const html = '<table><tbody><tr><td>a</td></tr></tbody></table><pre><code>x &lt; y</code></pre>';
        expect(sanitizeDocHtml(html)).toBe(html);
    });

    it('returns an empty string for nothing', () => {
        expect(sanitizeDocHtml(null)).toBe('');
        expect(sanitizeDocHtml(undefined)).toBe('');
        expect(sanitizeDocHtml('')).toBe('');
    });

    it('keeps the text of tags it does not allow', () => {
        expect(sanitizeDocHtml('<center>Hello <font color="red">there</font></center>')).toBe('Hello there');
    });

    it('keeps editor classes and drops others', () => {
        expect(sanitizeDocHtml('<p class="ql-align-center admin-only ah-note">x</p>')).toBe('<p class="ql-align-center ah-note">x</p>');
        expect(sanitizeDocHtml('<p class="admin-only">x</p>')).toBe('<p>x</p>');
    });

    it('keeps colour and alignment styles but not anything that can fetch or escape', () => {
        expect(sanitizeDocHtml('<p style="color: red; text-align: center">x</p>')).toBe('<p style="color: red; text-align: center">x</p>');
        expect(sanitizeDocHtml('<p style="position: fixed; top: 0">x</p>')).toBe('<p>x</p>');
        expect(sanitizeDocHtml('<p style="color: url(http://evil.test/x)">x</p>')).toBe('<p>x</p>');
        expect(sanitizeDocHtml('<p style="background-color: expression(alert(1))">x</p>')).toBe('<p>x</p>');
        expect(sanitizeDocHtml('<p style="color: red}body{display:none">x</p>')).toBe('<p>x</p>');
    });

    it('keeps the checklist marker on a list', () => {
        expect(sanitizeDocHtml('<ul data-checked="true"><li>done</li></ul>')).toBe('<ul data-checked="true"><li>done</li></ul>');
        expect(sanitizeDocHtml('<ul data-checked="maybe"><li>x</li></ul>')).toBe('<ul><li>x</li></ul>');
    });
});

describe('sanitizeDocHtml: scripts and handlers', () => {
    it.each([
        '<script>alert(1)</script>',
        '<SCRIPT SRC=//evil.test/x.js></SCRIPT>',
        '<style>body{display:none}</style>',
        '<svg onload=alert(1)><circle/></svg>',
        '<math><mi>x</mi></math>',
        '<object data="x"></object>',
        '<embed src="x">',
        '<form action="//evil.test"><input name="pw"></form>',
        '<button>Click</button>',
        '<textarea>x</textarea>',
        '<link rel="stylesheet" href="//evil.test/x.css">',
        '<meta http-equiv="refresh" content="0;url=//evil.test">',
        '<base href="//evil.test/">',
    ])('removes %s', (html) => {
        const out = sanitizeDocHtml(`before${html}after`);
        expect(out).toBe('beforeafter');
    });

    it('removes a script hidden inside another script opener', () => {
        const out = sanitizeDocHtml('<scr<script>x</script>ipt>alert(1)</script>');
        expect(out).not.toMatch(/<\s*script/i);
        expect(out).not.toContain('<');
    });

    it('removes an unclosed script opener', () => {
        const out = sanitizeDocHtml('<p>hi</p><script>alert(1)');
        expect(out).not.toMatch(/<script/i);
    });

    it('removes html comments', () => {
        expect(sanitizeDocHtml('a<!-- <script>x</script> -->b')).toBe('ab');
    });

    it('drops every on* handler', () => {
        expect(sanitizeDocHtml('<p onclick="alert(1)" onmouseover=alert(2)>x</p>')).toBe('<p>x</p>');
        expect(sanitizeDocHtml('<img src="https://a.test/i.png" onerror="alert(1)">')).toBe('<img src="https://a.test/i.png">');
    });

    it('turns a stray < in text into an entity', () => {
        const out = sanitizeDocHtml('1 < 2 and <b>bold</b>');
        expect(out).toBe('1 &lt; 2 and <b>bold</b>');
    });
});

describe('sanitizeDocHtml: links', () => {
    it('opens links away without carrying anything back', () => {
        const out = sanitizeDocHtml('<a href="https://a.test/x">go</a>');
        expect(out).toBe('<a href="https://a.test/x" target="_blank" rel="noopener noreferrer nofollow">go</a>');
    });

    it('adds https:// to a link written without a scheme', () => {
        expect(sanitizeDocHtml('<a href="www.alianhub.com">x</a>')).toContain('href="https://www.alianhub.com"');
    });

    it('keeps a host with a port', () => {
        expect(sanitizeDocHtml('<a href="www.alianhub.com:8443/docs">x</a>')).toContain('href="https://www.alianhub.com:8443/docs"');
    });

    it.each([
        'javascript:alert(1)',
        'JaVaScRiPt:alert(1)',
        'java\tscript:alert(1)',
        'javascript&#58;alert(1)',
        'javascript&colon;alert(1)',
        '&#106;avascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
        ' javascript:alert(1)',
    ])('drops the href %p', (href) => {
        const out = sanitizeDocHtml(`<a href="${href}">x</a>`);
        expect(out).not.toMatch(/href=/i);
        expect(out).not.toMatch(/target=/);
        expect(out).toBe('<a>x</a>');
    });

    it('allows mailto, anchors and site paths', () => {
        expect(sanitizeDocHtml('<a href="mailto:a@b.test">m</a>')).toContain('href="mailto:a@b.test"');
        expect(sanitizeDocHtml('<a href="#top">m</a>')).toContain('href="#top"');
        expect(sanitizeDocHtml('<a href="/docs">m</a>')).toContain('href="/docs"');
    });

    it('escapes quotes in attribute values', () => {
        const out = sanitizeDocHtml('<a href=\'https://a.test/?q="x"\' title=\'say "hi"\'>x</a>');
        expect(out).toContain('href="https://a.test/?q=&quot;x&quot;"');
        expect(out).toContain('title="say &quot;hi&quot;"');
    });
});

describe('sanitizeDocHtml: images and embeds', () => {
    it('keeps https images and small embedded png/jpeg/gif/webp, with plain sizes', () => {
        expect(sanitizeDocHtml('<img src="https://a.test/i.png" alt="logo" width="40" height="30">')).toBe('<img src="https://a.test/i.png" alt="logo" width="40" height="30">');
        expect(sanitizeDocHtml('<img src="data:image/png;base64,AAAA">')).toBe('<img src="data:image/png;base64,AAAA">');
    });

    it('drops images that are not http(s) or a safe data image', () => {
        expect(sanitizeDocHtml('<img src="javascript:alert(1)">')).toBe('<img>');
        expect(sanitizeDocHtml('<img src="data:image/svg+xml;base64,AAAA">')).toBe('<img>');
        expect(sanitizeDocHtml('<img src="data:text/html;base64,AAAA">')).toBe('<img>');
        expect(sanitizeDocHtml('<img src="//evil.test/x.png">')).toBe('<img>');
    });

    it('drops a size that is not a short number', () => {
        expect(sanitizeDocHtml('<img src="https://a.test/i.png" width="100%" height="99999">')).toBe('<img src="https://a.test/i.png">');
    });

    it('keeps a video embed from an allowed player', () => {
        const out = sanitizeDocHtml('<iframe class="ql-video" src="https://www.youtube.com/embed/abc123" allowfullscreen="true"></iframe>');
        expect(out).toContain('src="https://www.youtube.com/embed/abc123"');
        expect(out).toContain('allowfullscreen');
        expect(out).toContain('loading="lazy"');
        expect(out).toContain('referrerpolicy="strict-origin-when-cross-origin"');
        expect(out.endsWith('</iframe>')).toBe(true);
    });

    it.each([
        'https://evil.test/embed/abc',
        'http://www.youtube.com/embed/abc',
        'https://www.youtube.com.evil.test/embed/abc',
        'https://evil.test/?u=https://www.youtube.com/embed/abc',
        'javascript:alert(1)',
        'https://www.youtube.com/watch?v=abc',
    ])('removes an iframe pointing at %s, closing tag included', (src) => {
        expect(sanitizeDocHtml(`a<iframe src="${src}"></iframe>b`)).toBe('ab');
    });

    it('removes an iframe with no src at all', () => {
        expect(sanitizeDocHtml('a<iframe></iframe>b')).toBe('ab');
    });

    it.failing('keeps the bare allowfullscreen attribute on a video embed (it is dropped, so there is no full-screen button)', () => {
        const out = sanitizeDocHtml('<iframe src="https://www.youtube.com/embed/abc123" allowfullscreen></iframe>');
        expect(out).toContain('allowfullscreen');
    });

    it.failing('exports SAFE_EMBED_SRC (the module assigns it, then replaces its exports)', () => {
        expect(rules.SAFE_EMBED_SRC).toBeInstanceOf(RegExp);
    });
});

describe('create and intake validation (edges)', () => {
    it('lists the five shareable things', () => {
        expect(ENTITY_TYPES).toEqual(['sprint', 'report', 'page', 'form', 'client_view']);
    });

    it('checks the company first, then the type, then the id', () => {
        expect(validateCreateShare({}).reason).toBe('companyId is required.');
        expect(validateCreateShare({ companyId: 'c', entityType: 'user', entityId: 'x' }).reason).toContain('entityType must be one of');
        expect(validateCreateShare({ companyId: 'c', entityType: 'page', entityId: 'short' }).reason).toBe('A valid entityId is required.');
        expect(validateCreateShare({ companyId: 'c', entityType: 'page', entityId: '6f0000000000000000000a01' }).valid).toBe(true);
    });

    it('treats a missing id as not an object id', () => {
        expect(isObjectIdString(undefined)).toBe(false);
        expect(isObjectIdString('6f0000000000000000000a0g')).toBe(false);
    });

    it('requires a title that is not blank and not over 200 characters', () => {
        expect(validateIntakeSubmission({ title: '   ' }).valid).toBe(false);
        expect(validateIntakeSubmission({ title: 'x'.repeat(201) }).valid).toBe(false);
        expect(validateIntakeSubmission({ title: 'x'.repeat(200) }).valid).toBe(true);
    });

    it('limits name and email to 120 and description to 5000', () => {
        expect(validateIntakeSubmission({ title: 't', name: 'n'.repeat(121) }).reason).toBe('Name is too long.');
        expect(validateIntakeSubmission({ title: 't', email: 'e'.repeat(121) }).reason).toBe('Email is too long.');
        expect(validateIntakeSubmission({ title: 't', description: 'd'.repeat(5001) }).reason).toBe('Description is too long.');
        expect(validateIntakeSubmission({ title: 't', description: 'd'.repeat(5000), name: 'n', email: 'e@x.test' }).valid).toBe(true);
    });
});
