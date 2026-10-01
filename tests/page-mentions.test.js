const {
    normalizeMentionHtml,
    normalizeBlockMentions,
    mentionsIn,
    newUserMentions,
    mentionExcerpt,
    normalizeImageKey,
} = require('../Modules/Pages/helpers/pageMentions');
const { blocksToHtml, htmlToBlocks } = require('../Modules/Pages/helpers/pageContent');

const BOB = '64b7f0c2a1b2c3d4e5f60a01';
const ANN = '64b7f0c2a1b2c3d4e5f60a02';
const DOC = '64b7f0c2a1b2c3d4e5f60d01';
const TASK = '64b7f0c2a1b2c3d4e5f60b01';
const PAGE = '64b7f0c2a1b2c3d4e5f60c01';

const mention = (type, id, label, extra = '') => `<span class="mention" data-mention="${type}" data-id="${id}"${extra}>${label}</span>`;
const doc = (...blocks) => ({ time: 1, version: '2.30.7', blocks });
const paragraph = (text) => ({ type: 'paragraph', data: { text } });

describe('PAGES - mention markup', () => {
    test('a stored mention is rewritten to the canonical element, whatever else it carried', () => {
        const stored = `Ping <span onclick="steal()" data-id="${BOB}" style="color:red" data-mention="user" class="x" contenteditable="false">@Bob</span> now`;
        expect(normalizeMentionHtml(stored)).toBe(`Ping ${mention('user', BOB, '@Bob')} now`);
    });

    test('the label is escaped text, never markup', () => {
        const stored = mention('doc', DOC, '@<img src=x onerror=alert(1)>Plan &amp; "notes"');
        expect(normalizeMentionHtml(stored)).toBe(mention('doc', DOC, '@Plan &amp; &quot;notes&quot;'));
    });

    test('an unknown type or a malformed id leaves only the escaped label behind', () => {
        expect(normalizeMentionHtml(mention('project', DOC, '@Launch'))).toBe('@Launch');
        expect(normalizeMentionHtml(mention('user', 'javascript:alert(1)', '@<b>Bob</b>'))).toBe('@Bob');
    });

    test('ordinary spans and text are left alone', () => {
        const html = 'Plain <span class="cdx-marker">mark</span> and <b>bold</b>';
        expect(normalizeMentionHtml(html)).toBe(html);
    });

    test('every text-bearing block is normalised, including nested list items, checklists and tables', () => {
        const raw = mention('user', BOB, '@Bob', ' onclick="x()"');
        const data = normalizeBlockMentions(doc(
            paragraph(raw),
            { type: 'header', data: { text: raw, level: 2 } },
            { type: 'list', data: { style: 'unordered', items: [{ content: raw, items: [{ content: raw, items: [] }] }] } },
            { type: 'checklist', data: { items: [{ text: raw, checked: false }] } },
            { type: 'table', data: { content: [[raw, 'cell']] } },
            { type: 'callout', data: { text: raw, tone: 'info' } },
            { type: 'quote', data: { text: raw } },
        ));
        const clean = mention('user', BOB, '@Bob');
        expect(data.blocks[0].data.text).toBe(clean);
        expect(data.blocks[1].data.text).toBe(clean);
        expect(data.blocks[2].data.items[0].content).toBe(clean);
        expect(data.blocks[2].data.items[0].items[0].content).toBe(clean);
        expect(data.blocks[3].data.items[0].text).toBe(clean);
        expect(data.blocks[4].data.content[0]).toEqual([clean, 'cell']);
        expect(data.blocks[5].data.text).toBe(clean);
        expect(data.blocks[6].data.text).toBe(clean);
    });

    test('mentions are collected by type and id', () => {
        const data = doc(
            paragraph(`${mention('user', BOB, '@Bob')} see ${mention('doc', DOC, '@Plan')}`),
            { type: 'list', data: { items: [{ content: mention('task', TASK, '@AH-1'), items: [] }] } },
            paragraph(mention('user', BOB, '@Bob again')),
        );
        expect(mentionsIn(data)).toEqual([
            { type: 'user', id: BOB },
            { type: 'doc', id: DOC },
            { type: 'task', id: TASK },
        ]);
    });

    test('only people added since the last save count as newly mentioned', () => {
        const before = doc(paragraph(mention('user', BOB, '@Bob')));
        const after = doc(paragraph(`${mention('user', BOB, '@Bob')} and ${mention('user', ANN, '@Ann')}`));
        expect(newUserMentions(before, after)).toEqual([ANN]);
        expect(newUserMentions(after, after)).toEqual([]);
        expect(newUserMentions(null, before)).toEqual([BOB]);
    });

    test('the excerpt is the plain text of the block that names the person', () => {
        const data = doc(
            paragraph('Intro'),
            paragraph(`Can ${mention('user', ANN, '@Ann')} check the <b>numbers</b> &amp; totals?`),
        );
        expect(mentionExcerpt(data, ANN)).toBe('Can @Ann check the numbers & totals?');
        expect(mentionExcerpt(data, BOB)).toBe('');
    });
});

describe('PAGES - uploaded images', () => {
    test('an image block keeps a key only when it names a doc image', () => {
        expect(normalizeImageKey(`Pages/${PAGE}/20260930T101010000Z_3f2a.png`)).toBe(`Pages/${PAGE}/20260930T101010000Z_3f2a.png`);
        expect(normalizeImageKey(`Project/${PAGE}/Sprint/${TASK}/Attachment/secret.pdf`)).toBe('');
        expect(normalizeImageKey(`Pages/${PAGE}/../../etc/passwd`)).toBe('');
        expect(normalizeImageKey('Pages/nope/a.png')).toBe('');
    });

    test('image keys are sanitised when blocks are normalised', () => {
        const data = normalizeBlockMentions(doc(
            { type: 'image', data: { key: `Pages/${PAGE}/a.png`, caption: 'Chart' } },
            { type: 'image', data: { key: '/etc/passwd', url: 'https://example.test/x.png', caption: '' } },
        ));
        expect(data.blocks[0].data).toEqual({ key: `Pages/${PAGE}/a.png`, url: '', caption: 'Chart' });
        expect(data.blocks[1].data).toEqual({ key: '', url: 'https://example.test/x.png', caption: '' });
    });

    test('an uploaded image renders as a figure the viewer hydrates, and reads back', () => {
        const key = `Pages/${PAGE}/a.png`;
        const html = blocksToHtml([{ type: 'image', data: { key, caption: 'Q3 <chart>' } }]);
        expect(html).toBe(`<figure class="doc-image" data-image-key="${key}"><figcaption>Q3 &lt;chart&gt;</figcaption></figure>`);
        expect(htmlToBlocks(html)).toEqual([{ type: 'image', data: { key, url: '', caption: 'Q3 <chart>' } }]);
    });
});
