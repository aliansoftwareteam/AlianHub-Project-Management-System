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
    citationsFromPack,
    extractUsedHints,
    selectCitations,
    FALLBACK_PAGE_CITATIONS,
    FALLBACK_TASK_CITATIONS,
    WORKSPACE_ASK_SYSTEM,
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
        expect(AI_ACTIONS).toEqual(expect.arrayContaining(['draft', 'expand', 'summarize', 'outline', 'rewrite', 'ask', 'transcript', 'standup']));
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
        expect(pack.citations).toEqual([]);
    });

    test('context pack citations use pack ids, titles and project ids', () => {
        const pack = formatContextPack({
            pages: [{ _id: 'page1', title: 'Handbook', rawText: 'Onboarding lives here.', ProjectID: 'projA' }],
            tasks: [{ id: 'task1', TaskKey: 'AH-1', TaskName: 'Write the brief', ProjectID: 'projA' }],
        });
        expect(pack.pageText).toContain('[page:page1]');
        expect(pack.taskText).toContain('[task:task1]');
        expect(pack.citations).toEqual([
            { type: 'page', id: 'page1', title: 'Handbook', projectId: 'projA' },
            { type: 'task', id: 'task1', title: 'AH-1 Write the brief', projectId: 'projA' },
        ]);
        expect(citationsFromPack({
            pages: [{ _id: 'page1', title: 'Handbook', ProjectID: 'projA' }],
            tasks: [{ id: 'task1', TaskKey: 'AH-1', TaskName: 'Write the brief', ProjectID: 'projA' }],
        })).toEqual(pack.citations);
    });

    test('citation shaping drops invented ids and falls back to top N from the pack', () => {
        const pages = [
            { _id: 'p1', title: 'Alpha' },
            { _id: 'p2', title: 'Beta' },
            { _id: 'p3', title: 'Gamma' },
        ];
        const tasks = [
            { _id: 't1', TaskName: 'Ship it', ProjectID: 'projA' },
            { _id: 't2', TaskName: 'Polish' },
        ];
        const pack = formatContextPack({ pages, tasks });

        expect(selectCitations(pack.citations, [
            { type: 'page', id: 'p2' },
            { type: 'task', id: 'invented' },
            { type: 'page', id: 'p2' },
        ])).toEqual([{ type: 'page', id: 'p2', title: 'Beta' }]);

        expect(selectCitations(pack.citations, [
            { type: 'task', title: 'Ship it' },
        ])).toEqual([{ type: 'task', id: 't1', title: 'Ship it', projectId: 'projA' }]);

        expect(selectCitations(pack.citations, [{ type: 'page', id: 'nope' }])).toEqual(pack.citations);
        expect(selectCitations(pack.citations, [])).toEqual(pack.citations);
        expect(selectCitations([], [{ type: 'page', id: 'p1' }])).toEqual([]);

        const manyPages = Array.from({ length: 10 }, (_, i) => ({ _id: `p${i}`, title: `Page ${i}` }));
        const manyTasks = Array.from({ length: 10 }, (_, i) => ({ _id: `t${i}`, TaskName: `Task ${i}` }));
        const wide = formatContextPack({ pages: manyPages, tasks: manyTasks });
        const fallback = selectCitations(wide.citations, []);
        expect(fallback.filter((c) => c.type === 'page')).toHaveLength(FALLBACK_PAGE_CITATIONS);
        expect(fallback.filter((c) => c.type === 'task')).toHaveLength(FALLBACK_TASK_CITATIONS);
        expect(fallback[0]).toEqual({ type: 'page', id: 'p0', title: 'Page 0' });
    });

    test('extractUsedHints reads used ids from JSON and ignores count-style sources', () => {
        expect(extractUsedHints('{"markdown":"Hi","used":[{"type":"page","id":"p1"},{"type":"task","id":"t1"}]}')).toEqual([
            { type: 'page', id: 'p1' },
            { type: 'task', id: 't1' },
        ]);
        expect(extractUsedHints('```json\n{"markdown":"Hi","citations":[{"type":"pages","_id":"p1","title":"Handbook"}]}\n```')).toEqual([
            { type: 'page', id: 'p1', title: 'Handbook' },
        ]);
        expect(extractUsedHints('{"markdown":"Hi","sources":{"pages":2,"tasks":1}}')).toEqual([]);
        expect(extractUsedHints('not json')).toEqual([]);
        expect(WORKSPACE_ASK_SYSTEM).toMatch(/"used"/);
        expect(WORKSPACE_ASK_SYSTEM).toMatch(/\[page:<id>\]/);
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
        expect(src).toContain('WorkspaceAskCitations');
        expect(src).toContain('payload.citations');
    });

    test('workspace ask popover renders citation chips from the payload', () => {
        const popover = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'Pages', 'WorkspaceAskPopover.vue'), 'utf8');
        const chips = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'Pages', 'WorkspaceAskCitations.vue'), 'utf8');
        const panel = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'Pages', 'PagesPanel.vue'), 'utf8');
        const locale = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'locales', 'en.js'), 'utf8');
        expect(popover).toContain('WorkspaceAskCitations');
        expect(popover).toContain('payload.citations');
        expect(chips).toContain('data-citation-type');
        expect(chips).toContain('data-citation-id');
        expect(chips).toContain('pageOpenRoute');
        expect(chips).toContain('citation.projectId');
        expect(chips).not.toContain("name: 'Pages'");
        expect(panel).toContain('route.query');
        expect(panel).toContain('routePageId');
        expect(panel).toContain('routeProjectId');
        expect(panel).toContain('route.params.projectId');
        expect(panel).toContain('syncWorkspaceHash');
        expect(panel).toContain('pageOpenRoute');
        expect(panel).toContain('ProjectPages');
        expect(panel).toContain('stopImmediatePropagation');
        expect(panel).toContain('loadTree');
        expect(panel).toContain('workspace && routePageId.value && !projectId.value');
        const space = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'Pages', 'PagesSpace.vue'), 'utf8');
        const pagesRouter = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'router', 'pages', 'index.js'), 'utf8');
        const resolveSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'router', 'pages', 'resolvePageDeepLink.js'), 'utf8');
        const appRouter = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'router', 'index.js'), 'utf8');
        expect(space).toContain('route.params.projectId');
        expect(space).toContain('boundProject');
        expect(space).toContain('page_no_access');
        expect(space).toContain("kind === 'opening'");
        expect(space).toContain('pages-space__opening');
        expect(space).toContain('pageOpeningLine');
        expect(space).not.toContain('<PagesPanel workspace embedded />');
        expect(space).toContain('PagesPanel');
        expect(pagesRouter).toContain("name: 'ProjectPages'");
        expect(pagesRouter).toContain('/:cid/projects/:projectId/pages');
        expect(resolveSrc).toContain('resolvePageDeepLink');
        expect(resolveSrc).toContain('pageOpenRoute');
        expect(resolveSrc).toContain('pageFromGetResponse');
        expect(resolveSrc).toContain('/api/v2/pages/');
        expect(resolveSrc).toContain('fetchPageRow');
        expect(resolveSrc).not.toContain('pageDeepLinkNeedsResolve');
        expect(resolveSrc).toContain('knownPid');
        expect(appRouter).toContain('resolvePageDeepLink');
        const getPage = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Pages', 'controller.js'), 'utf8');
        expect(getPage).toContain('attachProjectsToPages');
        expect(getPage).toContain("statusText: 'Pages fetched.'");
        expect(locale).toContain('workspace_ask_sources');
        expect(locale).toContain('pages_citation_page');
        expect(locale).toContain('pages_citation_task');
    });
});
