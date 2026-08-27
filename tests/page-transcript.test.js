const fs = require('fs');
const path = require('path');
const { AI_ACTIONS, isAiAction } = require('../Modules/Pages/helpers/pageContent');
const { composePage } = require('../Modules/Pages/helpers/pageAi');
const { selectCitations } = require('../Modules/Pages/helpers/pageWorkspaceAsk');
const {
    TRANSCRIPT_SYSTEM,
    TRANSCRIPT_MAX_TOKENS,
    parseActionItems,
    actionItemsFromMarkdown,
    actionItemsToRequirements,
    shapeTranscriptResult,
    buildTranscriptPrompt,
} = require('../Modules/Pages/helpers/pageTranscript');

const PACK = [
    { type: 'task', id: 't1', title: 'Write the brief', projectId: 'projA' },
    { type: 'page', id: 'p1', title: 'Handbook', projectId: 'projA' },
];

describe('PAGES - meeting transcript', () => {

    test('transcript is a compose action and does not replace the page', () => {
        expect(AI_ACTIONS).toEqual(expect.arrayContaining(['ask', 'transcript']));
        expect(isAiAction('transcript')).toBe(true);
        expect(TRANSCRIPT_SYSTEM).toMatch(/Do not rewrite or replace any page/);
        expect(TRANSCRIPT_MAX_TOKENS).toBe(4096);
    });

    test('empty transcript is rejected before the model runs', async () => {
        const result = await composePage({ action: 'transcript', title: 'Standup', instruction: '   ', currentText: 'Keep me' });
        expect(result.status).toBe(false);
        expect(result.reason).toMatch(/transcript/i);
    });

    test('action items parse titles, owners, dates and pack-only related ids', () => {
        const items = parseActionItems([
            { title: 'Ship the invite', owner: 'Ada', due: 'Friday', relatedTaskId: 't1', relatedPageId: 'invented-page' },
            { title: 'Ghost work', relatedTaskId: 'nope', taskId: 'also-nope', pageId: 'p1' },
            'Follow up with design',
            { text: '  ' },
            null,
        ], PACK);
        expect(items).toEqual([
            { title: 'Ship the invite', owner: 'Ada', due: 'Friday', relatedTaskId: 't1' },
            { title: 'Ghost work', relatedPageId: 'p1' },
            { title: 'Follow up with design' },
        ]);
    });

    test('markdown action-item lists parse when JSON items are missing', () => {
        const md = '# Notes\n\nWe talked.\n\n## Action items\n- Book the room\n1. Send the deck\n\n## Other\n- Not an action';
        expect(actionItemsFromMarkdown(md)).toEqual([
            { title: 'Book the room' },
            { title: 'Send the deck' },
        ]);
        expect(actionItemsFromMarkdown('# Notes\n\n- just a bullet')).toEqual([]);
    });

    test('invented ids are dropped from citations and related fields', () => {
        const shaped = shapeTranscriptResult({
            title: 'Standup',
            markdown: 'We aligned on the invite.',
            actionItems: [
                { title: 'Ship the invite', relatedTaskId: 't1' },
                { title: 'Invented', relatedTaskId: 'ghost', relatedPageId: 'also-ghost' },
            ],
            packCitations: PACK,
            usedHints: [{ type: 'task', id: 'invented' }, { type: 'page', id: 'p1' }],
        });
        expect(shaped.status).toBe(true);
        expect(shaped.data.apply).toBe(false);
        expect(shaped.data.action).toBe('transcript');
        expect(shaped.data.actionItems).toEqual([
            { title: 'Ship the invite', relatedTaskId: 't1' },
            { title: 'Invented' },
        ]);
        expect(shaped.data.citations).toEqual([
            { type: 'page', id: 'p1', title: 'Handbook', projectId: 'projA' },
            { type: 'task', id: 't1', title: 'Write the brief', projectId: 'projA' },
        ]);
        expect(shaped.data.citations.some((row) => row.id === 'invented' || row.id === 'ghost')).toBe(false);
        expect(selectCitations(PACK, [{ type: 'task', id: 'nope' }], { fallback: false })).toEqual([]);
    });

    test('requirements text seeds the task wizard from parsed items', () => {
        const text = actionItemsToRequirements({
            title: 'Standup',
            markdown: 'We aligned on the invite.',
            actionItems: [
                { title: 'Ship the invite', owner: 'Ada', due: 'Friday', notes: 'Use the kiln template' },
            ],
        });
        expect(text).toContain('Standup');
        expect(text).toContain('We aligned on the invite.');
        expect(text).toContain('1. Ship the invite (owner: Ada) (due: Friday)');
        expect(text).toContain('Use the kiln template');
        expect(shapeTranscriptResult({
            title: 'Standup',
            markdown: 'Summary',
            actionItems: [{ title: 'Do the thing' }],
            packCitations: [],
        }).data.requirementsText).toContain('Do the thing');
    });

    test('transcript prompt carries the paste and says not to replace the page', () => {
        const prompt = buildTranscriptPrompt({
            title: 'Kickoff',
            transcript: 'Alex: let’s ship Friday.',
            currentText: 'Existing page body',
            pack: { pageText: '- Handbook', taskText: '- AH-1 Write the brief' },
        });
        expect(prompt).toContain('Kickoff');
        expect(prompt).toContain('Alex: let’s ship Friday.');
        expect(prompt).toContain('Current page body (do not replace)');
        expect(prompt).toContain('Existing page body');
        expect(prompt).toContain('Handbook');
    });

    test('compose rail shows a transcript paste path and does not apply the page', () => {
        const rail = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'Pages', 'PageComposeRail.vue'), 'utf8');
        const panel = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'Pages', 'PagesPanel.vue'), 'utf8');
        const locale = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'locales', 'en.js'), 'utf8');
        const provider = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Pages', 'helpers', 'pageAi.js'), 'utf8');
        const controller = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Pages', 'controller.js'), 'utf8');

        expect(rail).toContain("key: 'transcript'");
        expect(rail).toContain('pages_transcript_placeholder');
        expect(rail).toContain('pcr__input--area');
        expect(rail).toContain("payload.apply === false");
        expect(rail).toContain("action.value === 'transcript'");
        expect(rail).toContain("emit('apply'");
        expect(rail).toContain("emit('turn-into-tasks'");
        expect(rail).toContain('v-if="projectId && brief.items && brief.items.length"');
        expect(rail).toContain('pages_transcript_need_project');
        expect(panel).toContain(':project-id="taskProjectId"');
        expect(panel).toContain('v-if="taskProjectId"');
        expect(panel).toContain('@turn-into-tasks="openTurnIntoTasks"');
        expect(panel).toContain('typeof requirements === \'string\'');
        expect(locale).toContain('pages_compose_transcript');
        expect(provider).toContain('maxTokens');
        expect(controller).toContain('gatherWorkspaceAskContext');
        expect(controller).toContain("resolvedAction === 'transcript'");
    });
});
