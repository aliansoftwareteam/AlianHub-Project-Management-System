const fs = require('fs');
const path = require('path');
const {
    ALIAN_MENTION_KEY,
    hasAlianMention,
    extractAlianQuestion,
    shouldReplyAsAlian,
    citationsForComment,
    escapeCommentHtml,
    buildAlianComment,
} = require('../Modules/Comments/helpers/alianMention');
const { parseMentionIds } = require('../Modules/Comments/helpers/parseMentions');
const { selectCitations, formatContextPack } = require('../Modules/Pages/helpers/pageWorkspaceAsk');

const NO_QUESTION_TEXT = 'Ask a question after @Alian — I will look across pages and tasks you can open.';

describe('extractAlianQuestion', () => {
    test('reads the text after an autocomplete token', () => {
        expect(extractAlianQuestion('@[Alian](alian) what is the launch date?')).toEqual({
            mentioned: true,
            question: 'what is the launch date?',
        });
    });

    test('reads the text after a bare @Alian', () => {
        expect(extractAlianQuestion('@Alian summarize this sprint')).toEqual({
            mentioned: true,
            question: 'summarize this sprint',
        });
    });

    test('falls back to the rest of the comment when the mention is at the end', () => {
        expect(extractAlianQuestion('check the handbook @Alian')).toEqual({
            mentioned: true,
            question: 'check the handbook',
        });
    });

    test('is case-insensitive and strips leftover Alian tokens', () => {
        expect(extractAlianQuestion('@ALIAN foo @[Alian](alian) bar')).toEqual({
            mentioned: true,
            question: 'foo bar',
        });
    });

    test('decodes HTML entities from saved comments', () => {
        expect(extractAlianQuestion('@[Alian](alian) what&#039;s next?')).toEqual({
            mentioned: true,
            question: "what's next?",
        });
    });

    test('empty question when the comment is only the mention', () => {
        expect(extractAlianQuestion('@Alian')).toEqual({ mentioned: true, question: '' });
        expect(extractAlianQuestion('@[Alian](alian)')).toEqual({ mentioned: true, question: '' });
    });

    test('no mention yields mentioned false and no invented question', () => {
        expect(extractAlianQuestion('plain comment')).toEqual({ mentioned: false, question: '' });
        expect(extractAlianQuestion('')).toEqual({ mentioned: false, question: '' });
        expect(extractAlianQuestion(null)).toEqual({ mentioned: false, question: '' });
    });

    test('does not treat @AlianHub as @Alian', () => {
        expect(hasAlianMention('see @AlianHub docs')).toBe(false);
        expect(extractAlianQuestion('see @AlianHub docs').mentioned).toBe(false);
    });
});

describe('shouldReplyAsAlian', () => {
    const base = {
        userId: 'u1',
        taskId: '64a'.repeat(8),
        type: 'text',
        message: '@Alian what is next?',
    };

    test('true for a task text comment that mentions Alian', () => {
        expect(shouldReplyAsAlian(base)).toBe(true);
    });

    test('false for Alian\'s own comments, main chat, media, and no mention', () => {
        expect(shouldReplyAsAlian({ ...base, userId: ALIAN_MENTION_KEY })).toBe(false);
        expect(shouldReplyAsAlian({ ...base, taskId: 'default' })).toBe(false);
        expect(shouldReplyAsAlian({ ...base, taskId: '' })).toBe(false);
        expect(shouldReplyAsAlian({ ...base, type: 'image' })).toBe(false);
        expect(shouldReplyAsAlian({ ...base, message: 'hello' })).toBe(false);
    });
});

describe('citationsForComment — do not invent citations', () => {
    test('empty or missing input stays empty', () => {
        expect(citationsForComment(undefined)).toEqual([]);
        expect(citationsForComment(null)).toEqual([]);
        expect(citationsForComment([])).toEqual([]);
        expect(citationsForComment('pages:2')).toEqual([]);
    });

    test('drops invented types, missing ids, and extra fields', () => {
        expect(citationsForComment([
            { type: 'page', id: 'p1', title: 'Handbook', projectId: 'projA', secret: 'nope' },
            { type: 'wiki', id: 'x1', title: 'Invented' },
            { type: 'task', title: 'No id' },
            { type: 'task', id: 't1', TaskName: 'ignored' },
        ])).toEqual([
            { type: 'page', id: 'p1', title: 'Handbook', projectId: 'projA' },
            { type: 'task', id: 't1', title: '(untitled task)' },
        ]);
    });

    test('does not invent pack ids when the model returns none', () => {
        const pack = formatContextPack({
            pages: [{ _id: 'p1', title: 'Handbook' }],
            tasks: [{ _id: 't1', TaskName: 'Ship it' }],
        });
        expect(citationsForComment([])).toEqual([]);
        expect(citationsForComment(selectCitations(pack.citations, [{ type: 'page', id: 'invented' }]))).toEqual([
            { type: 'page', id: 'p1', title: 'Handbook' },
            { type: 'task', id: 't1', title: 'Ship it' },
        ]);
        expect(citationsForComment(selectCitations([], [{ type: 'page', id: 'p1' }]))).toEqual([]);
    });
});

describe('buildAlianComment', () => {
    test('authors as alian, replies to the source, and copies only real citations', () => {
        const source = {
            _id: 'c1',
            userId: 'u1',
            type: 'text',
            message: '@Alian what is next?',
            project: false,
            projectId: 'projA',
            sprintId: 's1',
            taskId: 't1',
        };
        const built = buildAlianComment(source, 'Ship the brief.', [
            { type: 'page', id: 'p1', title: 'Handbook' },
            { type: 'doc', id: 'nope' },
        ]);
        expect(built.userId).toBe(ALIAN_MENTION_KEY);
        expect(built.reply_id).toBe('c1');
        expect(built.reply_userId).toBe('u1');
        expect(built.taskId).toBe('t1');
        expect(built.citations).toEqual([{ type: 'page', id: 'p1', title: 'Handbook' }]);
        expect(built.message).toBe('Ship the brief.');
        expect(parseMentionIds(built.message)).toEqual([]);
        expect(NO_QUESTION_TEXT).toMatch(/@Alian/);
    });

    test('escapes HTML so a model cannot inject markup', () => {
        expect(escapeCommentHtml('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
        const built = buildAlianComment(
            { _id: 'c1', userId: 'u1', projectId: 'p', taskId: 't', sprintId: 's' },
            '<b>hi</b>',
            [],
        );
        expect(built.message).toBe('&lt;b&gt;hi&lt;/b&gt;');
        expect(built.citations).toEqual([]);
    });
});

describe('S1.3 wiring', () => {
    test('parseMentionIds does not treat alian as a user mention', () => {
        expect(parseMentionIds('@[Alian](alian) hi [Jane](aaaaaaaaaaaaaaaaaaaaaaaa)')).toEqual([
            'aaaaaaaaaaaaaaaaaaaaaaaa',
        ]);
    });

    test('CommentInput exposes a synthetic alian option', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'atom', 'CommentInput', 'CommentInput.vue'), 'utf8');
        expect(src).toContain("key: 'alian'");
        expect(src).toContain('includeAlian');
        expect(src).toContain('isAlian');
    });

    test('task comments enable Alian; main chat does not', () => {
        const comments = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'views', 'Projects', 'Comments', 'Comments.vue'), 'utf8');
        const composer = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'organisms', 'MainChat', 'MainChatComposer.vue'), 'utf8');
        expect(comments).toContain(':includeAlian="!mainChat"');
        expect(composer).toContain(':includeAlian="false"');
    });

    test('Alian comments render kiln citations without applying page content', () => {
        const comment = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'organisms', 'Comment', 'Comment.vue'), 'utf8');
        const compose = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'Pages', 'PageComposeRail.vue'), 'utf8');
        expect(comment).toContain('WorkspaceAskCitations');
        expect(comment).toContain('message.citations');
        expect(comment).toContain('is-alian');
        expect(compose).toContain('extractAlianQuestion');
        expect(compose).toContain('ask-workspace');
        expect(compose).toMatch(/payload\.apply === false/);
    });
});
