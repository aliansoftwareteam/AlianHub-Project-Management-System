/* Rich text as the API stores it: a description (strict) and a doc page (doc), held to the lists the web app draws with. */
const fs = require('fs');
const path = require('path');
const { cleanBlocks, cleanHtml, cleanDescription, cleanPageContent, plainTextOf, LIMITS, RichTextLimitError } = require('../Modules/Tasks/helpers/cleanRichText');
const allowlist = require('../Modules/Tasks/helpers/richTextAllowlist');
const { descriptionBlockFrom } = require('../Modules/Tasks/helpers/descriptionBlock');
const { markdownToBlocks } = require('../Modules/Pages/helpers/pageContent');

const RAN = 'window.__ran = 1';
const REMOTE = 'https://remote.example.test';
const LINK = 'target="_blank" rel="noopener noreferrer"';

// The same kinds of markup frontend/tests/unit/editorMarkup.spec.js draws.
const MARKUP = {
    'a script tag': `<script>${RAN}</script>`,
    'a handler attribute': `<p onclick="${RAN}">text</p>`,
    'a handler in mixed case': `<P oNcLiCk="${RAN}">text</P>`,
    'an image': `<img src="x" onerror="${RAN}">`,
    'a remote image': `<img src="${REMOTE}/p.png">`,
    'a script address in a link': `<a href="javascript:${RAN}">go</a>`,
    'a script address with a tab in it': `<a href="jav&#x09;ascript:${RAN}">go</a>`,
    'a script address in mixed case': `<a href=" JaVaScRiPt:${RAN}">go</a>`,
    'a data address in a link': `<a href="data:text/html,<script>${RAN}</script>">go</a>`,
    'an address with no scheme': '<a href="//remote.example.test/x">go</a><a href="/local">go</a>',
    'a frame': `<iframe src="${REMOTE}"></iframe>`,
    'a frame with a document in it': `<iframe srcdoc="<script>${RAN}</script>"></iframe>`,
    'a drawing': `<svg onload="${RAN}"><a xlink:href="javascript:${RAN}"><text>x</text></a><image href="${REMOTE}/i.png" /></svg>`,
    'a style tag': `<style>body{background:url(${REMOTE}/s.png)}</style>`,
    'a style attribute': `<p style="background:url(${REMOTE}/a.png);color:red;position:fixed">text</p>`,
    'a media tag': `<video src="x" onerror="${RAN}"></video><audio src="x" onerror="${RAN}"></audio>`,
    'an object': `<object data="${REMOTE}/o.swf"></object><embed src="${REMOTE}/e.swf">`,
    'a form': `<form action="${REMOTE}"><input name="q" autofocus onfocus="${RAN}"><button formaction="javascript:${RAN}">go</button></form>`,
    'a page instruction': `<meta http-equiv="refresh" content="0;url=${REMOTE}"><base href="${REMOTE}"><link rel="stylesheet" href="${REMOTE}/s.css">`,
    'a tag left open': `<b <script>${RAN}</script>x`,
    'a comment and a section': `<!-- <script>${RAN}</script> --><![CDATA[<script>${RAN}</script>]]>`,
    'an end tag written oddly': `<textarea></textarea/><img src="x" onerror="${RAN}"><title></title x><script>${RAN}</script><xmp></XMP/><a href="javascript:${RAN}">go</a>`,
    'markup inside an attribute': `<b title="<textarea></textarea/><img src=x onerror=${RAN}>">t</b><i class="&quot;><script>${RAN}</script>">i</i>`,
    'an image address that is a script': `<img src="javascript:${RAN}"><img src="data:text/html,<script>${RAN}</script>"><img src="data:image/svg+xml,<svg onload=${RAN}>">`,
};

const TAG = /<\/?([a-z][a-z0-9]*)((?:\s+[a-z][a-z0-9:-]*(?:="[^"<>]*")?)*)\s*>/g;
const ATTRIBUTE = /\s+([a-z][a-z0-9:-]*)(?:="([^"<>]*)")?/g;
const NEVER = ['script', 'iframe', 'image', 'style', 'video', 'audio', 'source', 'object', 'embed', 'form', 'input', 'button', 'meta', 'base', 'link', 'svg', 'math', 'template', 'textarea'];
const decoded = (value) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/* Everything in a cleaned string that could run or load, read without the cleaner's own lists. */
const problemsIn = (html, { page = false } = {}) => {
    const found = [];
    if (html.replace(TAG, '').includes('<')) found.push('markup outside a tag');
    for (const [, tag, attributes] of html.matchAll(TAG)) {
        if (NEVER.includes(tag) || (tag === 'img' && !page)) found.push(`<${tag}>`);
        for (const [, name, raw = ''] of attributes.matchAll(ATTRIBUTE)) {
            const value = decoded(raw).trim();
            if (name.startsWith('on') || ['srcset', 'srcdoc', 'action', 'formaction', 'background', 'poster', 'data', 'xlink:href'].includes(name)) found.push(`${tag}[${name}]`);
            if (name === 'href' && !(tag === 'a' && /^(https?:|mailto:)/i.test(value))) found.push(`${tag}[href=${value.slice(0, 20)}]`);
            if (name === 'src' && !(page && tag === 'img' && /^(https?:|data:image\/(png|gif|jpe?g|webp|bmp);)/i.test(value))) found.push(`${tag}[src=${value.slice(0, 20)}]`);
            if (name === 'style' && (!page || /url|expression|position|[()<>{}]/i.test(value.replace(/rgba?\([\d\s,.]+\)/gi, '')))) found.push(`${tag}[style]`);
        }
    }
    return found;
};

const documentWith = (source) => ({ time: 1, version: '2.30.7', blocks: [
    { id: 'b1', type: 'paragraph', data: { text: source } },
    { id: 'b2', type: 'header', data: { text: source, level: 2 } },
    { id: 'b3', type: 'list', data: { style: 'unordered', items: [{ content: source, items: [{ content: source, items: [] }] }, source] } },
    { id: 'b4', type: 'checklist', data: { items: [{ text: source, checked: true }] } },
    { id: 'b5', type: 'table', data: { withHeadings: false, content: [[source, 'plain']] } },
    { id: 'b6', type: 'quote', data: { text: source, caption: source } },
    { id: 'b7', type: 'callout', data: { tone: 'warn', text: source } },
    { id: 'b8', type: 'embed', data: { service: 'youtube', embed: 'https://www.youtube.com/embed/abc', source: 'https://www.youtube.com/watch?v=abc', caption: source } },
    { id: 'b9', type: 'unheard', data: { text: source } },
] });

const textsOf = (document) => document.blocks.flatMap((block) => ({
    paragraph: () => [block.data.text],
    header: () => [block.data.text],
    list: () => [block.data.items[0].content, block.data.items[0].items[0].content, block.data.items[1]],
    checklist: () => [block.data.items[0].text],
    table: () => block.data.content[0],
    quote: () => [block.data.text, block.data.caption],
    callout: () => [block.data.text],
    embed: () => [block.data.caption],
    unheard: () => [block.data.text],
}[block.type]()));

describe.each([['strict', {}], ['doc', { page: true }]])('text is stored as the editor would draw it: %s', (profile, reading) => {
    it.each(Object.entries(MARKUP))('as a string: %s', (_name, source) => {
        expect(problemsIn(cleanHtml(source, profile), reading)).toEqual([]);
    });

    it.each(Object.entries(MARKUP))('in every text of a document: %s', (_name, source) => {
        const texts = textsOf(cleanBlocks(documentWith(source), profile));
        expect(texts).toHaveLength(13);
        texts.forEach((text) => expect(problemsIn(text, reading)).toEqual([]));
    });

    it.each(Object.entries(MARKUP))('the same on a second pass: %s', (_name, source) => {
        const once = cleanBlocks(documentWith(source), profile);
        expect(JSON.stringify(cleanBlocks(once, profile))).toBe(JSON.stringify(once));
        expect(cleanHtml(cleanHtml(source, profile), profile)).toBe(cleanHtml(source, profile));
    });
});

describe('what a description keeps', () => {
    it('keeps the words of what it does not keep', () => {
        expect(cleanHtml('<p onclick="x">Do <strong>this</strong> <span>now</span></p><ul><li>then that</li></ul>')).toBe('<p>Do <strong>this</strong> now</p><ul><li>then that</li></ul>');
        expect(cleanBlocks({ blocks: [{ type: 'paragraph', data: { text: '<p>Do <b>this</b></p>' } }] }).blocks[0].data.text).toBe('Do <b>this</b>');
    });

    it('opens a link to a web or mail address apart from the app, and leaves any other as words', () => {
        expect(cleanHtml('<a href="https://example.test/spec?a=1&amp;b=2">the spec</a>')).toBe(`<a href="https://example.test/spec?a=1&amp;b=2" ${LINK}>the spec</a>`);
        expect(cleanHtml('<a href="mailto:pat@example.test" target="_top" rel="opener">write</a>')).toBe(`<a href="mailto:pat@example.test" ${LINK}>write</a>`);
        expect(cleanHtml('<a href="ftp://example.test/file" target="_blank">the file</a>')).toBe('<a>the file</a>');
    });

    it('keeps only the classes the editor\'s own tools write', () => {
        expect(cleanHtml('<code class="inline-code other">x</code> <mark class="cdx-marker">y</mark> <b class="anything">z</b>'))
            .toBe('<code class="inline-code">x</code> <mark class="cdx-marker">y</mark> <b>z</b>');
    });

    it('leaves text that is not markup as it was typed', () => {
        expect(cleanHtml('> a quote\n\n**bold** and `code`, 1 < 2 & 3 > 2')).toBe('> a quote\n\n**bold** and `code`, 1 &lt; 2 &amp; 3 > 2');
        expect(cleanHtml('plain words, "quoted", it\'s')).toBe('plain words, "quoted", it\'s');
        expect(cleanHtml('close it with /> or <br /> and <br/>')).toBe('close it with /> or <br> and <br>');
        expect(cleanHtml('<img src="https://example.test/a.png" alt="a /> b"> /> text', 'doc')).toBe('<img src="https://example.test/a.png" alt="a /&gt; b"> /&gt; text');
        expect([undefined, null].map((value) => cleanHtml(value))).toEqual([undefined, null]);
    });

    it('has no picture, colour or mention: those belong to a doc page', () => {
        const text = 'Ask <span class="mention" data-mention="user" data-id="6f0000000000000000000001">@Max</span> <span style="color:#ff0000">today</span> <img src="https://example.test/chart.png">';
        expect(cleanBlocks({ blocks: [{ type: 'paragraph', data: { text } }] }).blocks[0].data.text).toBe('Ask @Max today ');
    });
});

describe('what a doc page keeps', () => {
    it('keeps a mention, a picture, a colour and an alignment', () => {
        const mention = 'Ask <span class="mention" data-mention="user" data-id="6f0000000000000000000001">@Max</span> today';
        const picture = '<img src="https://example.test/chart.png" alt="chart">';
        const drawn = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="pasted">';
        const page = cleanBlocks({ blocks: [mention, picture, drawn].map((text) => ({ type: 'paragraph', data: { text } })) }, 'doc');
        expect(page.blocks.map((block) => block.data.text)).toEqual([mention, picture, drawn]);
        expect(cleanHtml('<p style="text-align: center"><span style="color: #ff0000; background-color: rgb(1, 2, 3)">today</span></p>', 'doc'))
            .toBe('<p style="text-align:center"><span style="color:#ff0000;background-color:rgb(1, 2, 3)">today</span></p>');
    });

    it('keeps the marks the app\'s own blocks leave in a page\'s HTML', () => {
        const html = '<aside class="callout callout--warn" data-tone="warn">Careful</aside>'
            + '<figure class="doc-image" data-image-key="Pages/6f0000000000000000000001/a.png"><figcaption>A chart</figcaption></figure>'
            + '<p class="task-block" data-task-id="6f0000000000000000000002">{{task:6f0000000000000000000002|AP-1}} Ship it</p>'
            + '<p class="task-list-block" data-project-id="6f0000000000000000000003" data-status-type="open">Task list: Web (open)</p><hr>';
        expect(cleanHtml(html, 'doc')).toBe(html);
    });

    it('cleans a page given as HTML and as blocks, and nothing else of it', () => {
        expect(cleanPageContent({ html: '<p onclick="x">One</p>', blocks: [{ type: 'paragraph', data: { text: '<i onclick="x">One</i>' } }], other: '<script>' }))
            .toEqual({ html: '<p>One</p>', blocks: [{ type: 'paragraph', data: { text: '<i>One</i>' } }] });
        expect(cleanPageContent(null)).toEqual({});
    });
});

describe('a document the editor made comes back as it went in', () => {
    const video = { id: 'e1', type: 'embed', data: { service: 'youtube', source: 'https://www.youtube.com/watch?v=abc', embed: 'https://www.youtube.com/embed/abc', width: 580, height: 320, caption: '' } };
    const gist = { id: 'e2', type: 'embed', data: { service: 'github', embed: 'data:text/html;charset=utf-8,<head><base target="_blank" /></head><body><script src="https://gist.github.com/pat/0a1b2c.js" ></script></body>', source: 'https://gist.github.com/pat/0a1b2c', caption: '' } };
    const description = { time: 5, version: '2.30.7', blocks: [
        { id: 'a', type: 'paragraph', data: { text: 'A <b>bold</b> <i>word</i>, <mark class="cdx-marker">marked</mark>, <code class="inline-code">x &lt; y</code><br>next&nbsp;line, "quoted", it\'s 3 &gt; 2 &amp; more' } },
        { id: 'b', type: 'header', data: { text: 'Plan', level: 2 } },
        { id: 'c', type: 'list', data: { style: 'ordered', items: [{ content: 'one <b>two</b>', items: [{ content: 'nested', items: [] }] }] } },
        { id: 'd', type: 'checklist', data: { items: [{ text: 'done <i>early</i>', checked: true }, { text: 'open', checked: false }] } },
        { id: 'e', type: 'table', data: { withHeadings: true, content: [['a', '<b>b</b>'], ['1', '2']] } },
        { id: 'f', type: 'code', data: { code: '<script>let x = 1 && y < 2;</script>' } },
        { id: 'g', type: 'paragraph', data: { text: `Read <a href="https://example.test/spec" ${LINK}>the spec</a>.` } },
        video,
        gist,
    ] };
    const page = { time: 7, version: '2.30.7', blocks: [
        ...description.blocks,
        { id: 'p1', type: 'paragraph', data: { text: 'Ask <span class="mention" data-mention="user" data-id="6f0000000000000000000001">@Max</span> and <span class="mention" data-mention="task" data-id="6f0000000000000000000002">@AP-1 Ship it</span>' } },
        { id: 'p2', type: 'callout', data: { text: '<b>Careful</b><br>twice', tone: 'warn' } },
        { id: 'p3', type: 'quote', data: { text: 'Said <i>so</i>' } },
        { id: 'p4', type: 'delimiter', data: {} },
        { id: 'p5', type: 'image', data: { url: '', key: 'Pages/6f0000000000000000000001/abc.png', caption: 'Sales < costs & "more"' } },
        { id: 'p6', type: 'image', data: { url: 'https://example.test/chart.png', key: '', caption: '' } },
        { id: 'p7', type: 'task', data: { taskId: '6f0000000000000000000002', taskKey: 'AP-1', title: 'Fix the <Header> & footer' } },
        { id: 'p8', type: 'taskList', data: { projectId: '6f0000000000000000000003', projectName: 'R&D <core>', statusType: 'open' } },
    ] };

    it('a description, block type by block type', () => {
        expect(JSON.stringify(cleanBlocks(description, 'strict'))).toBe(JSON.stringify(description));
    });

    it('a doc page, with the blocks the app\'s own tools draw', () => {
        expect(JSON.stringify(cleanBlocks(page, 'doc'))).toBe(JSON.stringify(page));
        expect(JSON.stringify(cleanBlocks(page.blocks, 'doc'))).toBe(JSON.stringify(page.blocks));
    });

    it('a description built from imported text', () => {
        const built = descriptionBlockFrom('Agree the date at https://example.test/spec?a=1&b=2\n- Book "the room"\n- it\'s <b>not bold</b>\n## Next\u00a0steps');
        expect(built.blocks).toHaveLength(3);
        expect(JSON.stringify(cleanBlocks(built, 'strict'))).toBe(JSON.stringify(built));
    });

    it('a page an agent wrote as markdown, once it has been cleaned', () => {
        const once = cleanBlocks(markdownToBlocks('# Plan\n\nShip "it" & rest\n\n- one\n- two\n\n```\nlet x = 1 < 2;\n```'), 'doc');
        expect(once.map((block) => block.type)).toEqual(['header', 'paragraph', 'list', 'code']);
        expect(JSON.stringify(cleanBlocks(once, 'doc'))).toBe(JSON.stringify(once));
    });

    it('with nothing to read as markup, the text is the same text', () => {
        const text = 'plain words';
        expect(cleanBlocks({ blocks: [{ type: 'paragraph', data: { text } }] }).blocks[0].data.text).toBe(text);
    });
});

describe('what a document may carry besides its text', () => {
    const only = (block, profile = 'strict') => cleanBlocks({ blocks: [block] }, profile).blocks;

    it('keeps a frame of a service the editor embeds, and turns any other into a link to where it came from', () => {
        const elsewhere = (embed, source = `${REMOTE}/page`) => only({ id: 'x1', type: 'embed', data: { service: 'youtube', embed, source, caption: '' } });
        const link = [{ id: 'x1', type: 'paragraph', data: { text: `<a href="${REMOTE}/page" ${LINK}>${REMOTE}/page</a>` } }];
        expect(elsewhere(`${REMOTE}/frame`)).toEqual(link);
        expect(elsewhere('http://www.youtube.com/embed/abc')).toEqual(link);
        expect(elsewhere(`data:text/html,<script>${RAN}</script>`)).toEqual(link);
        expect(elsewhere(`${REMOTE}/frame`, `javascript:${RAN}`)).toEqual([]);
        expect(elsewhere(undefined, null)).toEqual([]);
        expect(only({ type: 'embed', data: { service: 'youtube', embed: 'https://www.youtube.com/embed/abc', source: `javascript:${RAN}`, caption: '' } })[0].data.source).toBe('');
    });

    it('drops a key no tool draws when it could carry markup, and keeps the rest', () => {
        const [block] = only({ id: 'k1', type: 'paragraph', data: { text: 'hello', html: `<img src=x onerror="${RAN}">`, align: 'left', level: 3, wide: true, nested: { note: '<b>x</b>', kept: ['a', '<i>', 2] } }, tunes: { anchor: { id: 'top' } } });
        expect(block).toEqual({ id: 'k1', type: 'paragraph', data: { text: 'hello', align: 'left', level: 3, wide: true, nested: { kept: ['a', 2] } }, tunes: { anchor: { id: 'top' } } });
    });

    it('keeps an address only where it is a web address, or a picture on a doc page', () => {
        expect(only({ type: 'image', data: { url: `javascript:${RAN}`, file: { url: 'https://example.test/a.png' }, caption: '' } })[0].data).toEqual({ url: '', file: { url: 'https://example.test/a.png' }, caption: '' });
        expect(only({ type: 'image', data: { url: 'data:image/png;base64,iVBORw0KGgo=' } }, 'doc')[0].data.url).toBe('data:image/png;base64,iVBORw0KGgo=');
        expect(only({ type: 'image', data: { url: 'data:image/png;base64,iVBORw0KGgo=' } })[0].data.url).toBe('');
    });

    it('passes on what is not a document, and drops what is not a block', () => {
        expect(cleanBlocks(undefined)).toBeUndefined();
        expect(cleanBlocks({})).toEqual({});
        expect(cleanBlocks('older <b onclick="x">text</b>')).toBe('older <b>text</b>');
        expect(cleanBlocks({ blocks: [null, 'x', { type: 'paragraph' }, { type: '<b>', data: {} }], extra: '<script>' }).blocks).toEqual([{ type: 'paragraph', data: { text: '' } }]);
        expect(Object.keys(cleanBlocks(JSON.parse('{"blocks":[],"__proto__":{"x":1},"constructor":{"y":1}}')))).toEqual(['blocks']);
    });
});

describe('the plain text beside a description follows the document', () => {
    it('stays as sent while it says what the document says', () => {
        const sent = { descriptionBlock: { blocks: [{ type: 'paragraph', data: { text: '<b onclick="x">Bold</b> words' } }] }, rawDescription: 'Bold words, as the app wrote them' };
        expect(cleanDescription(sent)).toEqual({ descriptionBlock: { blocks: [{ type: 'paragraph', data: { text: '<b>Bold</b> words' } }] }, rawDescription: 'Bold words, as the app wrote them' });
    });

    it('is read again from the document when cleaning took words out of it', () => {
        const sent = { descriptionBlock: { blocks: [{ type: 'paragraph', data: { text: `Kept<script>${RAN}</script>` } }, { type: 'list', data: { items: ['one', { content: 'two', items: [{ content: 'three', items: [] }] }] } }] }, rawDescription: `Kept ${RAN}` };
        expect(cleanDescription(sent).rawDescription).toBe('Kept\n- one\n- two\n  - three');
        expect(plainTextOf(sent.descriptionBlock)).toBe('Kept\n- one\n- two\n  - three');
    });

    it('cleans the older text form where it stands', () => {
        expect(cleanDescription({ description: `Task A :  first <br> <img src=x onerror="${RAN}">Task B`, rawDescription: 7 })).toEqual({ description: 'Task A :  first <br> Task B', rawDescription: '' });
        expect(cleanDescription({ TaskName: 'No description here' })).toEqual({ TaskName: 'No description here' });
    });
});

describe('a document beyond a size limit is refused, saying which', () => {
    const paragraphs = (count) => ({ blocks: Array.from({ length: count }, () => ({ type: 'paragraph', data: { text: 'x' } })) });
    const nested = (levels) => ({ blocks: [{ type: 'list', data: { items: Array.from({ length: levels }).reduce((items) => [{ content: 'x', items }], []) } }] });
    const refusal = (run) => {
        try {
            run();
        } catch (error) {
            return error;
        }
        return null;
    };

    it.each([
        ['blocks', () => cleanBlocks(paragraphs(LIMITS.blocks + 1)), /5000 blocks/],
        ['items', () => cleanBlocks({ blocks: [{ type: 'list', data: { items: Array.from({ length: LIMITS.items + 1 }, () => 'x') } }] }), /20000 list items and table cells/],
        ['items', () => cleanBlocks({ blocks: [{ type: 'table', data: { content: Array.from({ length: 201 }, () => Array.from({ length: 100 }, () => 'x')) } }] }), /list items and table cells/],
        ['depth', () => cleanBlocks(nested(LIMITS.depth + 2)), /12 levels deep/],
        ['depth', () => cleanBlocks({ blocks: [{ type: 'paragraph', data: { text: 'x', tune: Array.from({ length: 20 }).reduce((inner) => ({ inner }), {}) } }] }), /levels deep/],
        ['tagDepth', () => cleanHtml(`${'<b>'.repeat(LIMITS.tagDepth + 1)}x`), /100 tags deep/],
        ['textLength', () => cleanHtml('x'.repeat(LIMITS.textLength + 1)), /1048576 characters/],
        ['textLength', () => cleanBlocks({ blocks: [{ type: 'code', data: { code: 'x'.repeat(LIMITS.textLength + 1) } }] }), /characters long/],
        ['textLength', () => cleanDescription({ rawDescription: 'x'.repeat(LIMITS.textLength + 1) }), /characters long/],
    ])('%s', (limit, run, message) => {
        const error = refusal(run);
        expect(error).toBeInstanceOf(RichTextLimitError);
        expect(error).toMatchObject({ limit, statusCode: 400 });
        expect(error.message).toMatch(message);
    });

    it('takes a document at the limits', () => {
        expect(cleanBlocks(paragraphs(LIMITS.blocks)).blocks).toHaveLength(LIMITS.blocks);
        expect(cleanBlocks(nested(LIMITS.depth - 1)).blocks).toHaveLength(1);
        expect(cleanHtml(`${'<b>'.repeat(LIMITS.tagDepth)}x`)).toMatch(/^<b>/);
        expect(cleanHtml('<p>line'.repeat(500))).toMatch(/^<p>line<\/p>/);
    });

    it('is done with a long run of markup in the time a save can take', () => {
        const started = Date.now();
        cleanHtml('<p class="a" onclick="x">hello <b>world</b> &amp; more</p>'.repeat(15000), 'doc');
        cleanBlocks({ blocks: Array.from({ length: LIMITS.blocks }, (_, at) => ({ type: 'paragraph', data: { text: `<b onclick="x">row ${at}</b>` } })) });
        expect(Date.now() - started).toBeLessThan(5000);
    });
});

describe('the web app and the API read one list', () => {
    const root = path.join(__dirname, '..');
    const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
    const shared = 'Modules/Tasks/helpers/richTextAllowlist.js';

    it.each(['frontend/vue.config.js', 'frontend/vitest.config.js'])('%s points the alias at the file the API requires', (config) => {
        expect(read(config)).toContain(`'@richTextAllowlist': path.resolve(__dirname, '../${shared}')`);
        expect(require.resolve('../Modules/Tasks/helpers/richTextAllowlist')).toBe(path.join(root, shared));
        expect(read('Modules/Tasks/helpers/cleanRichText.js')).toContain("require('./richTextAllowlist')");
    });

    it.each(['frontend/src/utils/editorHtml.js', 'frontend/src/utils/richHtml.js'])('%s takes its lists from it and holds none of its own', (file) => {
        const source = read(file);
        expect(source).toMatch(/import \{[^}]+\} from "@richTextAllowlist";/);
        expect(source).not.toMatch(/const [A-Z_]+ = \[\s*"[a-z]/);
        expect(source).not.toMatch(/https\?:\|mailto:/);
    });

    it('cannot be changed by either side', () => {
        const { strict, doc } = allowlist.profiles;
        [allowlist.profiles, strict, doc, strict.inlineTags, strict.blockTags, strict.attributes, strict.classes, doc.inlineTags, doc.attributes, doc.styleProperties, allowlist.EMBED_HOSTS, allowlist.LINK_SCHEMES]
            .forEach((list) => expect(Object.isFrozen(list)).toBe(true));
        expect(allowlist.LINK_SCHEMES).toEqual(['http', 'https', 'mailto']);
    });
});
