const {
    markdownToBlocks,
    markdownToEditorData,
    blocksToHtml,
    htmlToBlocks,
    contentToEditorData,
    isAiAction,
    AI_ACTIONS,
} = require('../Modules/Pages/helpers/pageContent');
const { parseMarkdownPayload, buildUserPrompt } = require('../Modules/Pages/helpers/pageAi');

describe('PAGES - block content', () => {

    test('markdown headings, lists and paragraphs become editor blocks', () => {
        const blocks = markdownToBlocks('# Title\n\nHello world.\n\n- one\n- two\n\n1. first');
        expect(blocks[0]).toEqual({ type: 'header', data: { text: 'Title', level: 1 } });
        expect(blocks[1].type).toBe('paragraph');
        expect(blocks[1].data.text).toContain('Hello world');
        expect(blocks[2].type).toBe('list');
        expect(blocks[2].data.style).toBe('unordered');
        expect(blocks[2].data.items).toHaveLength(2);
        expect(blocks[3].data.style).toBe('ordered');
    });

    test('code fences become a code block', () => {
        const blocks = markdownToBlocks('```\nconst x = 1;\n```');
        expect(blocks).toEqual([{ type: 'code', data: { code: 'const x = 1;' } }]);
    });

    test('blocks round-trip to html that htmlToBlocks can read', () => {
        const editor = markdownToEditorData('## Spec\n\nDo the thing.');
        const html = blocksToHtml(editor);
        expect(html).toContain('<h2>Spec</h2>');
        expect(html).toContain('Do the thing');
        const back = htmlToBlocks(html);
        expect(back[0].type).toBe('header');
        expect(back[0].data.level).toBe(2);
        expect(back.some((b) => b.type === 'paragraph')).toBe(true);
    });

    test('legacy html-only content seeds editor blocks', () => {
        const data = contentToEditorData({ html: '<h1>Old</h1><p>Quill body</p>' });
        expect(data.blocks[0].type).toBe('header');
        expect(data.blocks[0].data.text).toContain('Old');
    });

    test('stored Editor.js payload is used as-is', () => {
        const stored = { time: 1, blocks: [{ type: 'paragraph', data: { text: 'Hi' } }], version: '2.30.7' };
        expect(contentToEditorData({ blocks: stored }).blocks).toEqual(stored.blocks);
        expect(contentToEditorData({ blocks: stored.blocks }).blocks).toEqual(stored.blocks);
    });
});

describe('PAGES - AI helpers', () => {

    test('only the five compose actions are accepted', () => {
        AI_ACTIONS.forEach((action) => expect(isAiAction(action)).toBe(true));
        expect(isAiAction('chat')).toBe(false);
        expect(isAiAction('')).toBe(false);
    });

    test('parseMarkdownPayload reads JSON, fenced JSON, and raw markdown', () => {
        expect(parseMarkdownPayload('{"markdown":"# Hi"}')).toBe('# Hi');
        expect(parseMarkdownPayload('```json\n{"markdown":"Hello"}\n```')).toBe('Hello');
        expect(parseMarkdownPayload('## Outline\n- a')).toBe('## Outline\n- a');
        expect(parseMarkdownPayload('')).toBe('');
    });

    test('buildUserPrompt includes action, title, instruction and body', () => {
        const prompt = buildUserPrompt({
            action: 'expand',
            title: 'Runbook',
            instruction: 'Add rollback',
            currentText: 'Step 1',
        });
        expect(prompt).toContain('Action: expand');
        expect(prompt).toContain('Title: Runbook');
        expect(prompt).toContain('Add rollback');
        expect(prompt).toContain('Step 1');
    });
});
