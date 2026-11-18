const {
    markdownToBlocks,
    markdownToEditorData,
    blocksToHtml,
    blocksToRawText,
    blocksToSlides,
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

describe('PAGES - workspace blocks', () => {

    const TASK = '64b7f0c2a1b2c3d4e5f60777';
    const PROJECT = '64b7f0c2a1b2c3d4e5f60711';

    test('a task block serialises to the task token and round-trips', () => {
        const html = blocksToHtml([{ type: 'task', data: { taskId: TASK, taskKey: 'AHE-311', title: 'Onboarding <spec>' } }]);
        expect(html).toContain(`data-task-id="${TASK}"`);
        expect(html).toContain(`{{task:${TASK}|AHE-311}}`);
        expect(html).toContain('Onboarding &lt;spec&gt;');
        const back = htmlToBlocks(html);
        expect(back).toEqual([{ type: 'task', data: { taskId: TASK, taskKey: 'AHE-311', title: 'Onboarding <spec>' } }]);
        expect(blocksToRawText(back)).toContain('AHE-311');
    });

    test('a task block without a task renders nothing', () => {
        expect(blocksToHtml([{ type: 'task', data: {} }])).toBe('');
    });

    test('a task list block keeps its project and filter through html', () => {
        const html = blocksToHtml([{ type: 'taskList', data: { projectId: PROJECT, projectName: 'Website Revamp', statusType: 'close' } }]);
        expect(html).toContain(`data-project-id="${PROJECT}"`);
        expect(html).toContain('data-status-type="close"');
        const back = htmlToBlocks(html);
        expect(back[0].type).toBe('taskList');
        expect(back[0].data).toEqual({ projectId: PROJECT, projectName: 'Website Revamp', statusType: 'close' });
    });

    test('an unknown task list filter falls back to open', () => {
        const html = blocksToHtml([{ type: 'taskList', data: { projectId: PROJECT, projectName: 'X', statusType: 'weird' } }]);
        expect(html).toContain('data-status-type="open"');
    });

    test('callout, delimiter, image and embed serialise and read back', () => {
        const html = blocksToHtml([
            { type: 'callout', data: { text: 'Open decision.', tone: 'warn' } },
            { type: 'delimiter', data: {} },
            { type: 'image', data: { url: 'https://x/y.png', caption: 'Flow' } },
            { type: 'embed', data: { service: 'youtube', source: 'https://youtu.be/abc', embed: 'https://www.youtube.com/embed/abc' } },
        ]);
        expect(html).toContain('<aside class="callout callout--warn" data-tone="warn">Open decision.</aside>');
        expect(html).toContain('<hr>');
        expect(html).toContain('<figure><img src="https://x/y.png" alt="Flow"><figcaption>Flow</figcaption></figure>');
        expect(html).toContain('<a href="https://youtu.be/abc">');
        const back = htmlToBlocks(html);
        expect(back.map((b) => b.type)).toEqual(['callout', 'delimiter', 'image', 'paragraph']);
        expect(back[0].data).toEqual({ text: 'Open decision.', tone: 'warn' });
        expect(back[2].data).toEqual({ url: 'https://x/y.png', caption: 'Flow' });
    });

    test('an unknown callout tone becomes info', () => {
        expect(blocksToHtml([{ type: 'callout', data: { text: 'x', tone: 'loud' } }])).toContain('data-tone="info"');
    });

    test('headings split a page into slides, with a title slide for anything above the first', () => {
        const slides = blocksToSlides([
            { type: 'paragraph', data: { text: 'Intro' } },
            { type: 'header', data: { text: 'Sprint 14', level: 1 } },
            { type: 'paragraph', data: { text: '68% done' } },
            { type: 'header', data: { text: 'Detail', level: 3 } },
            { type: 'header', data: { text: 'Next', level: 2 } },
        ], 'Report');
        expect(slides.map((s) => s.heading)).toEqual(['Report', 'Sprint 14', 'Next']);
        expect(slides[1].blocks).toHaveLength(2);
        expect(slides[2].blocks).toHaveLength(0);
        expect(blocksToSlides([], 'Empty')).toEqual([]);
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
