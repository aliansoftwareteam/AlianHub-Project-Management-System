const { chunkPage, MAX_CHUNK_CHARS } = require('../Modules/Knowledge/ingest/chunker');
const { htmlToRawText } = require('../Modules/Pages/helpers/pageRules');

const page = (html, over = {}) => ({ title: 'Onboarding', content: { html }, ...over });

describe('chunking a page on its structure', () => {
    const html = '<p>Welcome aboard.</p>'
        + '<h2>Accounts</h2><p>Ask IT for a laptop.</p>'
        + '<h3>Email</h3><p>Use the company domain.</p>'
        + '<h2>Payroll</h2><p>Paid on the last working day.</p>';

    it('starts a chunk at every heading and records the path of headings above it', () => {
        const chunks = chunkPage(page(html));
        expect(chunks.map((c) => c.headingPath)).toEqual([
            ['Onboarding'],
            ['Onboarding', 'Accounts'],
            ['Onboarding', 'Accounts', 'Email'],
            ['Onboarding', 'Payroll'],
        ]);
        expect(chunks.map((c) => c.ordinal)).toEqual([0, 1, 2, 3]);
    });

    it('keeps each section to its own text, with the title only in the opening chunk', () => {
        const [intro, accounts, email, payroll] = chunkPage(page(html));
        expect(intro.text).toBe('Onboarding\nWelcome aboard.');
        expect(accounts.text).toBe('Accounts\nAsk IT for a laptop.');
        expect(email.text).toBe('Email\nUse the company domain.');
        expect(payroll.text).toBe('Payroll\nPaid on the last working day.');
        [accounts, email, payroll].forEach((c) => expect(c.text).not.toContain('Onboarding'));
    });

    it('closes a deeper heading when a shallower one follows', () => {
        const chunks = chunkPage(page('<h2>A</h2><p>a</p><h3>B</h3><p>b</p><h4>C</h4><p>c</p><h2>D</h2><p>d</p><h3>E</h3><p>e</p>'));
        expect(chunks.map((c) => c.headingPath.slice(1).join(' > '))).toEqual(['', 'A', 'A > B', 'A > B > C', 'D', 'D > E']);
    });

    it('splits a long section on paragraph boundaries, and every piece keeps the heading path', () => {
        const paragraph = (n) => `<p>${`Paragraph ${n} `.repeat(40).trim()}</p>`;
        const chunks = chunkPage(page(`<h2>Long</h2>${[1, 2, 3, 4, 5, 6].map(paragraph).join('')}`));
        const long = chunks.filter((c) => c.headingPath.join('/') === 'Onboarding/Long');
        expect(long.length).toBeGreaterThan(1);
        long.forEach((c) => expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS));
        const paragraphs = long.flatMap((c) => c.text.split('\n')).filter((line) => line.startsWith('Paragraph'));
        expect(paragraphs).toHaveLength(6);
    });

    it('splits one paragraph longer than a chunk on word boundaries', () => {
        const words = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ');
        const chunks = chunkPage(page(`<p>${words}</p>`));
        expect(chunks.length).toBeGreaterThan(1);
        chunks.forEach((c) => expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS));
        const seen = chunks.flatMap((c) => c.text.split(/\s+/)).filter((w) => /^word\d+$/.test(w));
        expect(seen).toEqual(words.split(' '));
    });

    it('reads the whole body from content.html, past where rawText is cut', () => {
        const filler = '<p>filler text for a long page</p>'.repeat(300);
        const body = `${filler}<h2>Appendix</h2><p>The tail mentions zanzibar.</p>`;
        expect(htmlToRawText(body)).not.toContain('zanzibar');
        const chunks = chunkPage(page(body, { rawText: htmlToRawText(body) }));
        expect(chunks.some((c) => c.text.includes('zanzibar'))).toBe(true);
    });

    it('falls back to the editor blocks when a page has no html', () => {
        const chunks = chunkPage({ title: 'Guide', content: { blocks: [{ type: 'header', data: { text: 'Setup', level: 2 } }, { type: 'paragraph', data: { text: 'Install the app.' } }] } });
        expect(chunks.map((c) => c.text)).toEqual(['Guide', 'Setup\nInstall the app.']);
    });

    it('gives a page with no body one chunk holding its title, so it is still found by title', () => {
        expect(chunkPage({ title: 'Empty page', content: {} }).map((c) => [c.headingPath, c.text])).toEqual([[['Empty page'], 'Empty page']]);
    });

    it('strips tags, decodes entities and keeps list items on their own lines', () => {
        const [chunk] = chunkPage(page('<p>Fish &amp; chips&nbsp;&lt;today&gt;</p><ul><li>one</li><li><b>two</b></li></ul>'));
        expect(chunk.text).toBe('Onboarding\nFish & chips <today>\none\ntwo');
    });

    it('hashes each chunk from its headings and text, so an edit changes only the chunk it touched', () => {
        const before = chunkPage(page(html));
        const again = chunkPage(page(html));
        const after = chunkPage(page(html.replace('Paid on the last working day.', 'Paid on the first working day.')));
        expect(again.map((c) => c.contentHash)).toEqual(before.map((c) => c.contentHash));
        expect(after.map((c, i) => c.contentHash === before[i].contentHash)).toEqual([true, true, true, false]);
        expect(before.every((c) => /^[a-f0-9]{64}$/.test(c.contentHash))).toBe(true);
    });
});
