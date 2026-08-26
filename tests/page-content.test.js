const {
    markdownToBlocks,
    markdownToEditorData,
    blocksToHtml,
    htmlToBlocks,
    contentToEditorData,
    unwrapBlockList,
    isAiAction,
    AI_ACTIONS,
} = require('../Modules/Pages/helpers/pageContent');
const { parseMarkdownPayload, buildUserPrompt, composePage } = require('../Modules/Pages/helpers/pageAi');
const {
    pageReadableBy,
    pageInVisibleProjects,
    formatContextPack,
    buildWorkspaceAskPrompt,
} = require('../Modules/Pages/helpers/pageWorkspaceAsk');
const fs = require('fs');
const path = require('path');

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

    test('compose apply wrapping unwraps nested Editor.js payloads', () => {
        const inner = [{ type: 'paragraph', data: { text: 'Hi' } }];
        const nested = { time: 1, blocks: { time: 2, blocks: inner, version: '2.30.7' }, version: '2.30.7' };
        expect(unwrapBlockList(nested)).toEqual(inner);
        expect(contentToEditorData({ blocks: nested }).blocks).toEqual(inner);
        expect(contentToEditorData({ blocks: { blocks: nested } }).blocks).toEqual(inner);
        expect(Array.isArray(contentToEditorData({ blocks: nested }).blocks)).toBe(true);
        expect(contentToEditorData({ blocks: nested }).blocks[0].type).toBe('paragraph');
    });
});

describe('PAGES - AI helpers', () => {

    test('compose actions include ask', () => {
        expect(AI_ACTIONS).toEqual(expect.arrayContaining(['draft', 'expand', 'summarize', 'outline', 'rewrite', 'ask']));
        AI_ACTIONS.forEach((action) => expect(isAiAction(action)).toBe(true));
        expect(isAiAction('chat')).toBe(false);
        expect(isAiAction('workspace')).toBe(false);
        expect(isAiAction('')).toBe(false);
    });

    test('SYSTEM_PROMPT documents ask without replacing the page', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Pages', 'helpers', 'pageAi.js'), 'utf8');
        expect(src).toMatch(/- ask: answer the author's question about the current page/);
        expect(src).toMatch(/Do not rewrite or replace the page/);
    });

    test('ask with an empty instruction is rejected before the model runs', async () => {
        const result = await composePage({ action: 'ask', title: 'Brief', instruction: '   ', currentText: 'Body' });
        expect(result.status).toBe(false);
        expect(result.reason).toMatch(/question/i);
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

describe('PAGES - workspace ask', () => {

    test('private pages are hidden from other authors', () => {
        const page = { title: 'Secret', visibility: 'private', createdBy: 'u1' };
        expect(pageReadableBy(page, 'u1')).toBe(true);
        expect(pageReadableBy(page, 'u2')).toBe(false);
        expect(pageReadableBy({ visibility: 'project', createdBy: 'u1' }, 'u2')).toBe(true);
    });

    test('pages on projects the caller cannot see are dropped', () => {
        expect(pageInVisibleProjects({ ProjectID: 'p1' }, ['p1'], true)).toBe(true);
        expect(pageInVisibleProjects({ ProjectID: 'p2' }, ['p1'], true)).toBe(false);
        expect(pageInVisibleProjects({ title: 'Workspace' }, ['p1'], true)).toBe(true);
        expect(pageInVisibleProjects({ ProjectID: 'p2' }, ['p1'], false)).toBe(true);
    });

    test('context pack lists titles only the caller handed in', () => {
        const pack = formatContextPack({
            pages: [{ title: 'Handbook', rawText: 'Onboarding lives here.' }],
            tasks: [{ TaskKey: 'AH-1', TaskName: 'Write the brief' }],
        });
        expect(pack.pageCount).toBe(1);
        expect(pack.taskCount).toBe(1);
        expect(pack.pageText).toContain('Handbook');
        expect(pack.taskText).toContain('AH-1');
        expect(pack.taskText).toContain('Write the brief');
    });

    test('workspace ask prompt carries the question and both lists', () => {
        const pack = formatContextPack({
            pages: [{ title: 'Plan' }],
            tasks: [{ TaskName: 'Ship it' }],
        });
        const prompt = buildWorkspaceAskPrompt({ question: 'What is next?', pack });
        expect(prompt).toContain('What is next?');
        expect(prompt).toContain('Plan');
        expect(prompt).toContain('Ship it');
    });
});

describe('PAGES - kiln follow-up guards', () => {

    test('en.js Projects has a single untitled_page key', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'locales', 'en.js'), 'utf8');
        const hits = src.match(/untitled_page\s*:/g) || [];
        expect(hits).toHaveLength(1);
    });

    test('App.vue does not hard-require FirstRunChecklist', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'App.vue'), 'utf8');
        expect(src).not.toMatch(/import FirstRunChecklist from ["']@\/components\/molecules\/FirstRunChecklist\/FirstRunChecklist\.vue["']/);
        expect(src).toContain('require.context');
        expect(src).toContain('FirstRunChecklist');
    });

    test('compose rail Ask chip does not apply page content', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'Pages', 'PageComposeRail.vue'), 'utf8');
        expect(src).toContain("key: 'ask'");
        expect(src).toContain('pages_ask_needed');
        expect(src).toContain('white-space: pre-wrap');
        expect(src).toMatch(/action\.value === 'ask'/);
        expect(src).toContain("emit('apply'");
        expect(src).toMatch(/payload\.apply === false/);
    });
});
