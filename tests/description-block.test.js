const { descriptionBlockFrom, hasBlocks, withDescriptionBlock } = require('../Modules/Tasks/helpers/descriptionBlock');

const blocksOf = (text, options) => descriptionBlockFrom(text, options).blocks;
const paragraph = (text) => ({ type: 'paragraph', data: { text } });
const item = (content) => ({ content, items: [] });

describe('a description written as text, as the task editor stores it', () => {
    it('is an editor document: a time, a version and blocks', () => {
        const block = descriptionBlockFrom('Agree the date');
        expect(block).toEqual({ time: expect.any(Number), version: expect.stringMatching(/^\d+\.\d+\.\d+$/), blocks: [paragraph('Agree the date')] });
    });

    it('makes each line a paragraph and drops the empty ones, as typing them would', () => {
        expect(blocksOf('Goal: ship\nDone when: it ships\n\n\r\nAnd a third   ')).toEqual([paragraph('Goal: ship'), paragraph('Done when: it ships'), paragraph('And a third')]);
    });

    it('is nothing for no text', () => {
        expect(descriptionBlockFrom('')).toEqual({});
        expect(descriptionBlockFrom('  \n ')).toEqual({});
        expect(descriptionBlockFrom(undefined)).toEqual({});
        expect(descriptionBlockFrom(null)).toEqual({});
    });

    it('groups bulleted lines into one list and numbered lines into another', () => {
        expect(blocksOf('Before launch:\n- Book the room\n* Send invites\n• Print badges\nThen:\n1. Open the doors\n2) Start')).toEqual([
            paragraph('Before launch:'),
            { type: 'list', data: { style: 'unordered', items: [item('Book the room'), item('Send invites'), item('Print badges')] } },
            paragraph('Then:'),
            { type: 'list', data: { style: 'ordered', items: [item('Open the doors'), item('Start')] } },
        ]);
    });

    it('reads a heading line', () => {
        expect(blocksOf('## Acceptance\nIt ships')).toEqual([{ type: 'header', data: { text: 'Acceptance', level: 2 } }, paragraph('It ships')]);
        expect(blocksOf('#hashtag is text')).toEqual([paragraph('#hashtag is text')]);
    });

    it('turns a web address into a link that shows the address itself', () => {
        expect(blocksOf('See https://example.test/spec?a=1&b=2.')).toEqual([
            paragraph('See <a href="https://example.test/spec?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">https://example.test/spec?a=1&amp;b=2</a>.'),
        ]);
        expect(blocksOf('- the brief: http://example.test/brief')).toEqual([
            { type: 'list', data: { style: 'unordered', items: [item('the brief: <a href="http://example.test/brief" target="_blank" rel="noopener noreferrer">http://example.test/brief</a>')] } },
        ]);
    });

    it('shows where a named link really goes', () => {
        expect(blocksOf('Read [the spec](https://example.test/spec) first')).toEqual([
            paragraph('Read the spec (<a href="https://example.test/spec" target="_blank" rel="noopener noreferrer">https://example.test/spec</a>) first'),
        ]);
    });

    it('leaves addresses as text when links are not wanted', () => {
        expect(blocksOf('See https://example.test/spec', { links: false })).toEqual([paragraph('See https://example.test/spec')]);
        expect(blocksOf('Read [the spec](https://example.test/spec)', { links: false })).toEqual([paragraph('Read [the spec](https://example.test/spec)')]);
    });

    it('carries nothing that runs: markup is shown as the text it is', () => {
        const hostile = [
            '<script>alert(1)</script>',
            '<img src=x onerror="alert(1)">',
            '<a href="javascript:alert(1)">click</a>',
            '[click](javascript:alert(1))',
            'https://example.test/"onmouseover="alert(1)',
            '- <b onclick=alert(1)>bold</b>',
            '# <iframe src="https://example.test">',
        ].join('\n');
        const html = blocksOf(hostile).flatMap((block) => (block.type === 'list' ? block.data.items.map((entry) => entry.content) : [block.data.text])).join('\n');
        expect(html).not.toMatch(/<(?!a href="https?:\/\/[^"<>]*" target="_blank" rel="noopener noreferrer">|\/a>)/);
        expect(html).not.toMatch(/javascript:[^"]*"\s*>/);
        expect(blocksOf('<b>bold</b> & "quoted"')).toEqual([paragraph('&lt;b&gt;bold&lt;/b&gt; &amp; "quoted"')]);
        expect(blocksOf('https://example.test/"onmouseover="alert(1)')).toEqual([
            paragraph('<a href="https://example.test/" target="_blank" rel="noopener noreferrer">https://example.test/</a>"onmouseover="alert(1)'),
        ]);
    });

    it('bounds what one description becomes', () => {
        const long = Array.from({ length: 3000 }, (_, index) => `line ${index}`).join('\n');
        expect(blocksOf(long).length).toBeLessThanOrEqual(1000);
    });
});

describe('whether a stored description has anything to show', () => {
    it('is true only for a document with blocks', () => {
        expect(hasBlocks({ blocks: [paragraph('x')] })).toBe(true);
        expect([{}, { blocks: [] }, null, undefined, 'text', { blocks: 'x' }].map(hasBlocks)).toEqual([false, false, false, false, false, false]);
    });
});

describe('a new task that brings its description as text alone', () => {
    it('gets the document the task panel reads', () => {
        const task = withDescriptionBlock({ TaskName: 'Plan', rawDescription: 'Agree the date\n- book the room', descriptionBlock: {} });
        expect(task.descriptionBlock.blocks).toEqual([paragraph('Agree the date'), { type: 'list', data: { style: 'unordered', items: [item('book the room')] } }]);
        expect(task.rawDescription).toBe('Agree the date\n- book the room');
    });

    it('keeps the document it was given', () => {
        const given = { time: 1, version: '2.30.7', blocks: [paragraph('Typed in the editor')] };
        expect(withDescriptionBlock({ rawDescription: 'Typed in the editor', descriptionBlock: given }).descriptionBlock).toBe(given);
    });

    it('is left alone when it has no text, or when it carries the older description field the panel still reads', () => {
        expect(withDescriptionBlock({ rawDescription: '', descriptionBlock: {} }).descriptionBlock).toEqual({});
        expect(withDescriptionBlock({ TaskName: 'x' }).descriptionBlock).toBeUndefined();
        expect(withDescriptionBlock({ rawDescription: 'md', description: '<p>md</p>' }).descriptionBlock).toBeUndefined();
        expect(withDescriptionBlock({ rawDescription: 'text', descriptionBlock: 'older text form' }).descriptionBlock).toBe('older text form');
    });

    it('links nothing in text that arrived from outside: an email, a public form, a webhook', () => {
        const task = withDescriptionBlock({ rawDescription: 'Pay at https://example.test/pay', origin: { kind: 'email', ref: 'x' } });
        expect(task.descriptionBlock.blocks).toEqual([paragraph('Pay at https://example.test/pay')]);
    });
});
