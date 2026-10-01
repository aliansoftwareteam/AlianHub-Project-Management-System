import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import EditorJS from '@editorjs/editorjs';
import Header from '@editorjs/header';
import List from '@editorjs/nested-list';
import Checklist from '@editorjs/checklist';
import Marker from '@editorjs/marker';
import CodeTool from '@editorjs/code';
import InlineCode from '@editorjs/inline-code';
import Embed from '@editorjs/embed';
import Table from '@editorjs/table';
import { descriptionTextHtml, safeEditorDocument } from '@/utils/editorHtml';
import { richHtml } from '@/utils/richHtml';

/* A description is read in two forms: text (markdown, or HTML the app wrote) and the document the editor stores. A doc
   page is such a document too. Each ends as HTML an editor tool sets on an element, so each is checked here at every
   point it is set. */

const RAN = 'window.__ran = 1';
const REMOTE = 'https://remote.example.test';

const MARKUP = {
    'a script tag': `<script>${RAN}</script>`,
    'a handler attribute': `<p onclick="${RAN}">text</p>`,
    'a handler in mixed case': `<P oNcLiCk="${RAN}">text</P>`,
    'an image': `<img src="x" onerror="${RAN}">`,
    'a remote image': `<img src="${REMOTE}/p.png">`,
    'a remote image in markdown': `![pixel](${REMOTE}/p.png)`,
    'a script address in a link': `<a href="javascript:${RAN}">go</a>`,
    'a script address in a markdown link': `[go](javascript:${RAN})`,
    'a script address with a tab in it': `<a href="jav&#x09;ascript:${RAN}">go</a>`,
    'a data address in a link': `<a href="data:text/html,<script>${RAN}</script>">go</a>`,
    'a data address in a markdown link': `[go](data:text/html;base64,PHNjcmlwdD4xPC9zY3JpcHQ+)`,
    'a frame': `<iframe src="${REMOTE}"></iframe>`,
    'a frame with a document in it': `<iframe srcdoc="<script>${RAN}</script>"></iframe>`,
    'a drawing': `<svg onload="${RAN}"><a xlink:href="javascript:${RAN}"><text>x</text></a><image href="${REMOTE}/i.png" /></svg>`,
    'a style tag': `<style>body{background:url(${REMOTE}/s.png)}</style>`,
    'a style attribute': `<p style="background:url(${REMOTE}/a.png)">text</p>`,
    'a media tag': `<video src="x" onerror="${RAN}"></video><audio src="x" onerror="${RAN}"></audio>`,
    'an object': `<object data="${REMOTE}/o.swf"></object><embed src="${REMOTE}/e.swf">`,
    'a form': `<form action="${REMOTE}"><input name="q" autofocus onfocus="${RAN}"><button formaction="javascript:${RAN}">go</button></form>`,
    'a page instruction': `<meta http-equiv="refresh" content="0;url=${REMOTE}"><base href="${REMOTE}"><link rel="stylesheet" href="${REMOTE}/s.css">`,
    'markup inside a list': `- <img src="x" onerror="${RAN}">\n- <b onmouseover="${RAN}">bold</b>`,
    'markup inside a table': `| a |\n| - |\n| <img src="x" onerror="${RAN}"> |`,
};

const LOADING = 'script, iframe, img, image, style, video, audio, source, object, embed, form, input, button, meta, base, link, svg, math, template';
const ADDRESS_ATTRS = ['src', 'srcset', 'srcdoc', 'action', 'formaction', 'background', 'poster', 'data', 'xlink:href'];
const LINK = /^(https?:|mailto:)/i;

const inert = (html) => new DOMParser().parseFromString(String(html), 'text/html').body;

const PICTURE = /^(https?:|data:image\/(png|gif|jpe?g|webp|bmp);)/i;

/* Everything in `root` that could run or fetch: a tag from the list, a handler, a style, or an address outside a plain
   link. A doc page (`page`) also keeps a picture from a web address and a plain colour, as its preview does. */
const problemsIn = (root, { allow = '', page = false } = {}) => {
    const found = [];
    root.querySelectorAll('*').forEach((node) => {
        const tag = node.tagName.toLowerCase();
        const picture = page && tag === 'img';
        if (node.matches(LOADING) && !picture && !(allow && node.matches(allow))) found.push(`<${tag}>`);
        [...node.attributes].forEach(({ name, value }) => {
            const attr = name.toLowerCase();
            if (picture && attr === 'src' && PICTURE.test(value.trim())) return;
            if (page && attr === 'style' && !/url|expression|[()<>{}]/i.test(value.replace(/rgba?\([\d\s,.]+\)/gi, ''))) return;
            if (attr.startsWith('on') || attr === 'style' || ADDRESS_ATTRS.includes(attr)) found.push(`${tag}[${attr}]`);
            if (attr === 'href' && !(tag === 'a' && LINK.test(value.trim()))) found.push(`${tag}[href=${value.slice(0, 20)}]`);
        });
    });
    return found;
};

describe('markup in a description is shown as text', () => {
    it.each(Object.entries(MARKUP))('in the text form: %s', (_name, source) => {
        expect(problemsIn(inert(descriptionTextHtml(source)))).toEqual([]);
    });

    it.each(Object.entries(MARKUP))('in a stored document: %s', (_name, source) => {
        const shown = safeEditorDocument({ time: 1, version: '2.30.7', blocks: [
            { type: 'paragraph', data: { text: source } },
            { type: 'header', data: { text: source, level: 2 } },
            { type: 'list', data: { style: 'unordered', items: [{ content: source, items: [{ content: source, items: [] }] }, source] } },
            { type: 'checklist', data: { items: [{ text: source, checked: true }] } },
            { type: 'table', data: { withHeadings: false, content: [[source, 'plain']] } },
            { type: 'embed', data: { service: 'youtube', embed: 'https://www.youtube.com/embed/abc', source: 'https://www.youtube.com/watch?v=abc', caption: source } },
        ] });
        const texts = shown.blocks.flatMap((block) => ({
            paragraph: () => [block.data.text],
            header: () => [block.data.text],
            list: () => [block.data.items[0].content, block.data.items[0].items[0].content, block.data.items[1]],
            checklist: () => [block.data.items[0].text],
            table: () => block.data.content[0],
            embed: () => [block.data.caption],
        }[block.type]()));
        expect(texts).toHaveLength(9);
        texts.forEach((text) => expect(problemsIn(inert(text))).toEqual([]));
    });
});

const storedWith = (source) => ({ time: 1, version: '2.30.7', blocks: [
    { type: 'paragraph', data: { text: source } },
    { type: 'header', data: { text: source, level: 2 } },
    { type: 'list', data: { style: 'unordered', items: [{ content: source, items: [{ content: source, items: [] }] }] } },
    { type: 'checklist', data: { items: [{ text: source, checked: false }] } },
    { type: 'table', data: { withHeadings: false, content: [[source]] } },
] });
const textsOf = (stored) => stored.blocks.flatMap((block) => ({
    paragraph: () => [block.data.text],
    header: () => [block.data.text],
    list: () => [block.data.items[0].content, block.data.items[0].items[0].content],
    checklist: () => [block.data.items[0].text],
    table: () => block.data.content[0],
}[block.type]()));
const safePage = (stored) => safeEditorDocument(stored, { inline: richHtml });

describe('markup in a doc page is shown as text', () => {
    it.each(Object.entries(MARKUP))('in a stored page: %s', (_name, source) => {
        const texts = textsOf(safePage(storedWith(source)));
        expect(texts).toHaveLength(6);
        texts.forEach((text) => expect(problemsIn(inert(text), { page: true })).toEqual([]));
    });

    it('keeps what a page\'s preview keeps: a mention, a picture, a colour, and the blocks the app\'s own tools draw', () => {
        const mention = 'Ask <span class="mention" data-mention="user" data-id="6f0000000000000000000001">@Max</span> <span style="color: #ff0000">today</span>';
        const picture = '<img src="https://example.test/chart.png" alt="chart">';
        const callout = { type: 'callout', data: { tone: 'warn', text: '<b>Careful</b>' } };
        const image = { type: 'image', data: { key: 'Docs/abc.png', caption: 'A chart' } };
        const page = safePage({ blocks: [{ type: 'paragraph', data: { text: mention } }, { type: 'paragraph', data: { text: picture } }, callout, image] });
        expect(page.blocks[0].data.text).toBe('Ask <span class="mention" data-mention="user" data-id="6f0000000000000000000001">@Max</span> <span style="color:#ff0000">today</span>');
        expect(page.blocks[1].data.text).toBe(picture);
        expect(page.blocks.slice(2)).toEqual([callout, image]);
    });

    it('keeps a frame the editor embeds and turns any other into a link, as a description does', () => {
        const frame = (embed) => ({ type: 'embed', data: { service: 'youtube', embed, source: `${REMOTE}/page`, caption: '' } });
        expect(safePage({ blocks: [frame('https://www.youtube.com/embed/abc')] }).blocks[0].type).toBe('embed');
        expect(safePage({ blocks: [frame(`${REMOTE}/frame`)] }).blocks).toEqual([
            { type: 'paragraph', data: { text: `<a href="${REMOTE}/page" target="_blank" rel="noopener noreferrer">${REMOTE}/page</a>` } },
        ]);
    });
});

describe('what a description keeps', () => {
    const shown = (source) => descriptionTextHtml(source).trim();

    it('keeps markdown: emphasis, code, lists, headings and tables', () => {
        expect(shown('**bold** and *soft* and `code`')).toBe('<p><b>bold</b> and <i>soft</i> and <code class="inline-code">code</code></p>');
        expect(shown('## Plan\n\n- one\n- two\n\n1. first')).toBe('<h2>Plan</h2>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<ol>\n<li>first</li>\n</ol>');
        expect(inert(shown('| a | b |\n| - | - |\n| 1 | 2 |')).querySelectorAll('table td')).toHaveLength(2);
    });

    it('keeps the HTML the app itself wrote into older descriptions', () => {
        expect(shown('<p>Do <strong>this</strong> <em>now</em></p><ul><li>then that</li></ul>')).toBe('<p>Do <b>this</b> <i>now</i></p><ul><li>then that</li></ul>');
        expect(shown('Task A :  first <br> Task B :  second')).toBe('<p>Task A :  first <br> Task B :  second</p>');
    });

    it('keeps a link to a web or mail address, opened apart from the app', () => {
        expect(shown('[the spec](https://example.test/spec)')).toBe('<p><a href="https://example.test/spec" target="_blank" rel="noopener noreferrer">the spec</a></p>');
        expect(shown('<a href="mailto:pat@example.test" target="_top" rel="opener">write</a>')).toBe('<p><a href="mailto:pat@example.test" target="_blank" rel="noopener noreferrer">write</a></p>');
    });

    it('keeps the words of a link it does not follow, and the name of an image it does not load', () => {
        expect(shown('<a href="ftp://example.test/file" target="_blank">the file</a>')).toBe('<p><a>the file</a></p>');
        expect(shown('![the chart](https://example.test/chart.png)')).toBe('<p>!<a href="https://example.test/chart.png" target="_blank" rel="noopener noreferrer">the chart</a></p>');
    });

    it('keeps only the classes the editor\'s own tools write', () => {
        expect(shown('<code class="inline-code other">x</code> <mark class="cdx-marker">y</mark> <b class="anything">z</b>')).toBe('<p><code class="inline-code">x</code> <mark class="cdx-marker">y</mark> <b>z</b></p>');
    });

    it('is nothing for no text', () => {
        expect([undefined, null, ''].map(descriptionTextHtml)).toEqual(['', '', '']);
    });
});

describe('what a stored document keeps', () => {
    const only = (block) => safeEditorDocument({ blocks: [block] }).blocks;

    it('keeps the editor\'s own formatting and leaves code as it was typed', () => {
        const blocks = [
            { id: 'a', type: 'paragraph', data: { text: 'A <b>bold</b> <i>word</i>, <mark class="cdx-marker">marked</mark>, <code class="inline-code">x &lt; y</code><br>next' } },
            { id: 'b', type: 'code', data: { code: '<script>let x = 1;</script>' } },
            { id: 'c', type: 'table', data: { withHeadings: true, content: [['a', '<b>b</b>']] } },
        ];
        expect(safeEditorDocument({ time: 5, version: '2.30.7', blocks })).toEqual({ time: 5, version: '2.30.7', blocks });
    });

    it('keeps a frame of a service the editor embeds, and turns any other into a link to where it came from', () => {
        const video = { type: 'embed', data: { service: 'youtube', embed: 'https://www.youtube.com/embed/abc', source: 'https://www.youtube.com/watch?v=abc', caption: '' } };
        const gist = { type: 'embed', data: { service: 'github', embed: 'data:text/html;charset=utf-8,<head><base target="_blank" /></head><body><script src="https://gist.github.com/pat/0a1b2c.js" ></script></body>', source: 'https://gist.github.com/pat/0a1b2c', caption: '' } };
        expect(only(video)).toEqual([video]);
        expect(only(gist)).toEqual([gist]);

        const elsewhere = (embed, source = `${REMOTE}/page`) => only({ type: 'embed', data: { service: 'youtube', embed, source, caption: '' } });
        const link = [{ type: 'paragraph', data: { text: `<a href="${REMOTE}/page" target="_blank" rel="noopener noreferrer">${REMOTE}/page</a>` } }];
        expect(elsewhere(`${REMOTE}/frame`)).toEqual(link);
        expect(elsewhere('http://www.youtube.com/embed/abc')).toEqual(link);
        expect(elsewhere(`data:text/html,<script>${RAN}</script>`)).toEqual(link);
        expect(elsewhere(`data:text/html;charset=utf-8,<head><base target="_blank" /></head><body><script src="${REMOTE}/x.js" ></script></body>`)).toEqual(link);
        expect(elsewhere(`${REMOTE}/frame`, `javascript:${RAN}`)).toEqual([]);
        expect(elsewhere(undefined, null)).toEqual([]);
    });

    it('passes on what is not a document', () => {
        expect(safeEditorDocument('older text')).toBe('older text');
        expect(safeEditorDocument(undefined)).toBeUndefined();
        expect(safeEditorDocument({})).toEqual({});
        expect(safeEditorDocument({ blocks: [null, 'x', { type: 'paragraph' }] }).blocks).toEqual([{ type: 'paragraph', data: { text: '' } }]);
    });
});

describe('through the editor itself', () => {
    const tools = () => ({ header: Header, list: List, checklist: Checklist, marker: Marker, code: CodeTool, inlineCode: InlineCode, embed: Embed, table: Table });
    const withoutEmbed = () => Object.fromEntries(Object.entries(tools()).filter(([name]) => name !== 'embed'));
    const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
    const setter = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    const written = [];
    let converter;
    let editor;

    beforeAll(async () => {
        window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
        ['description-converter', 'description-editor'].forEach((id) => {
            const holder = document.createElement('div');
            holder.id = id;
            document.body.appendChild(holder);
        });
        converter = new EditorJS({ holder: 'description-converter', tools: withoutEmbed() });
        editor = new EditorJS({ holder: 'description-editor', tools: tools() });
        await Promise.all([converter.isReady, editor.isReady]);
        Object.defineProperty(Element.prototype, 'innerHTML', { ...setter, set(value) { written.push(String(value)); setter.set.call(this, value); } });
    });

    afterAll(() => {
        Object.defineProperty(Element.prototype, 'innerHTML', setter);
    });

    /* The path Description.vue takes for a description held as text: text, to HTML, to blocks, to the page. */
    const show = async (source) => {
        written.length = 0;
        delete window.__ran;
        await converter.blocks.renderFromHTML(descriptionTextHtml(source));
        await settle();
        const { blocks } = await converter.save();
        await editor.render(safeEditorDocument({ blocks }));
        await settle(30);
        return { blocks, page: document.querySelector('#description-editor .codex-editor__redactor') };
    };

    // The table and list tools draw their own controls with icons; those are the editor's, not the description's.
    const ownIcons = { allow: 'svg' };

    it.each(Object.entries(MARKUP))('nothing that runs or loads is set on the page: %s', async (_name, source) => {
        const { page } = await show(source);
        written.forEach((html) => expect(problemsIn(inert(html), ownIcons)).toEqual([]));
        expect(problemsIn(page, ownIcons)).toEqual([]);
        expect(page.querySelectorAll('.ce-block__content svg [onload], .ce-block__content a:not([rel="noopener noreferrer"])[href]')).toHaveLength(0);
        expect(window.__ran).toBeUndefined();
    }, 15000);

    it('shows markdown as the blocks a person would have typed', async () => {
        const { blocks, page } = await show('## Plan\n\nDo **this** then [read](https://example.test/spec).\n\n- one\n- two');
        expect(blocks.map((block) => block.type)).toEqual(['header', 'paragraph', 'list']);
        expect(page.querySelector('h2').textContent).toBe('Plan');
        expect(page.querySelector('.ce-paragraph').innerHTML).toBe('Do <b>this</b> then <a href="https://example.test/spec" target="_blank" rel="noopener noreferrer">read</a>.');
    }, 15000);

    it.each(Object.entries(MARKUP))('nothing that runs is set on the page from a stored doc page: %s', async (_name, source) => {
        written.length = 0;
        delete window.__ran;
        await editor.render(safePage(storedWith(source)));
        await settle(30);
        const page = document.querySelector('#description-editor .codex-editor__redactor');
        written.forEach((html) => expect(problemsIn(inert(html), { ...ownIcons, page: true })).toEqual([]));
        expect(problemsIn(page, { ...ownIcons, page: true })).toEqual([]);
        expect(window.__ran).toBeUndefined();
    }, 15000);

    it('leaves the address of a video as an address: text alone never becomes a frame', async () => {
        for (const source of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', '<div>https://www.youtube.com/watch?v=dQw4w9WgXcQ</div>', '<span>https://codepen.io/pat/pen/abcdef</span>']) {
            const { blocks, page } = await show(source);
            expect(blocks.map((block) => block.type)).toEqual(['paragraph']);
            expect(page.querySelectorAll('iframe')).toHaveLength(0);
        }
    }, 15000);
});

describe('the description component reads a description only this way', () => {
    const source = readFileSync(path.resolve(__dirname, '../../src/components/atom/Description/Description.vue'), 'utf8');

    it('renders text through the one renderer and a document through the one check', () => {
        expect(source).not.toMatch(/markdown-it|markdownit/);
        expect(source.match(/renderFromHTML\(([^)]*)\)/g)).toEqual(['renderFromHTML(descriptionTextHtml(description)']);
        const rendered = [...source.matchAll(/editor\.value\??\.render\(([^\n]*)/g)].map((match) => match[1]);
        expect(rendered).toHaveLength(3);
        rendered.forEach((argument) => expect(argument).toMatch(/^(safeEditorDocument\(|obj\))/));
    });

    it('converts text with no tool that builds a frame', () => {
        expect(source).toMatch(/tools: converterTools\(\)/);
        expect(source).toMatch(/const converterTools = \(\) => Object\.fromEntries\(Object\.entries\(editorTools\)\.filter\(\(\[name\]\) => name !== 'embed'\)\);/);
    });
});

describe('the docs editor draws a page only this way', () => {
    const source = readFileSync(path.resolve(__dirname, '../../src/components/molecules/Pages/PageBlockEditor.vue'), 'utf8');

    it('holds the page it opens with, and every page it draws later, to what the preview shows', () => {
        expect(source).toMatch(/const safePage = \(data\) => safeEditorDocument\(data, \{ inline: richHtml \}\);/);
        expect(source).toMatch(/return safePage\(contentToEditorData\(props\.seed \|\| \{\}\)\);/);
        expect(source).toMatch(/data: seedData\(\),/);
        const rendered = [...source.matchAll(/editor\.value\.render\(([^\n]*)/g)].map((match) => match[1]);
        expect(rendered).toHaveLength(2);
        rendered.forEach((argument) => expect(argument).toMatch(/\? safePage\((incoming|data)\) : emptyEditorData\(\)\);$/));
    });
});
