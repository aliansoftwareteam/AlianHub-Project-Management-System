jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const mockProvider = { chat: jest.fn() };
const mockFactory = { isAnyProviderConfigured: jest.fn(() => true), getProvider: jest.fn(() => mockProvider) };
jest.mock('../Modules/AICore/llmProvider', () => mockFactory);

const pageAi = require('../Modules/Pages/helpers/pageAi');

const answer = (content) => mockProvider.chat.mockResolvedValue({ content });

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockFactory.isAnyProviderConfigured.mockReturnValue(true);
    mockFactory.getProvider.mockReturnValue(mockProvider);
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe('parseMarkdownPayload', () => {
    it('reads the markdown key of a JSON answer', () => {
        expect(pageAi.parseMarkdownPayload('{"markdown":"# Hi"}')).toBe('# Hi');
    });

    it('also accepts a content key', () => {
        expect(pageAi.parseMarkdownPayload('{"content":"body"}')).toBe('body');
    });

    it('unwraps JSON inside a code fence', () => {
        expect(pageAi.parseMarkdownPayload('Here:\n```json\n{"markdown":"# A"}\n```')).toBe('# A');
    });

    it('keeps the fenced text itself when it is not JSON', () => {
        expect(pageAi.parseMarkdownPayload('```\n# Plain heading\n```')).toBe('# Plain heading');
    });

    it('recovers the markdown from JSON cut short or with raw line breaks', () => {
        expect(pageAi.parseMarkdownPayload('{"markdown":"# T\\nline \\"q\\""}')).toBe('# T\nline "q"');
        expect(pageAi.parseMarkdownPayload('{"markdown":"a\nb"}')).toBe('a\nb');
    });

    it('returns plain text unchanged', () => {
        expect(pageAi.parseMarkdownPayload('  Just text  ')).toBe('Just text');
    });

    it('returns an empty string for nothing', () => {
        expect(pageAi.parseMarkdownPayload('')).toBe('');
        expect(pageAi.parseMarkdownPayload(null)).toBe('');
        expect(pageAi.parseMarkdownPayload(undefined)).toBe('');
    });

    it('returns the text of JSON that has neither key', () => {
        expect(pageAi.parseMarkdownPayload('{"other":1}')).toBe('{"other":1}');
    });
});

describe('buildUserPrompt', () => {
    it('names the action and title, and marks an empty body', () => {
        const prompt = pageAi.buildUserPrompt({ action: 'draft', title: 'Roadmap' });
        expect(prompt).toContain('Action: draft');
        expect(prompt).toContain('Title: Roadmap');
        expect(prompt).toContain('Current page body: (empty)');
        expect(prompt).not.toContain('Author instruction');
    });

    it('calls a missing title untitled and includes the instruction and body when given', () => {
        const prompt = pageAi.buildUserPrompt({ action: 'ask', title: '', instruction: 'What changed?', currentText: 'v2 notes' });
        expect(prompt).toContain('Title: (untitled)');
        expect(prompt).toContain('Author instruction:\nWhat changed?');
        expect(prompt).toContain('Current page body:\nv2 notes');
    });
});

describe('composePage', () => {
    it('refuses an unknown action and lists the valid ones', async () => {
        const out = await pageAi.composePage({ action: 'translate' });
        expect(out.status).toBe(false);
        expect(out.reason).toContain('draft, expand, summarize, outline, rewrite, ask');
        expect(mockProvider.chat).not.toHaveBeenCalled();
    });

    it('says AI is not integrated when no provider is set up', async () => {
        mockFactory.isAnyProviderConfigured.mockReturnValue(false);
        const out = await pageAi.composePage({ action: 'draft', title: 'x' });
        expect(out).toEqual({ status: false, reason: 'AI is not integrated in your system', isNotAi: true });
    });

    it('reports the provider\'s own message when choosing a provider fails', async () => {
        mockFactory.getProvider.mockImplementation(() => { throw new Error('Key expired'); });
        const out = await pageAi.composePage({ action: 'draft' });
        expect(out).toEqual({ status: false, reason: 'Key expired' });
    });

    it('turns the model\'s markdown into html, editor blocks and a preview', async () => {
        answer('{"markdown":"# Launch plan\\n\\n- one\\n- two"}');
        const out = await pageAi.composePage({ action: 'DRAFT', title: 'Launch', companyId: 'c1', userId: 'u1' });
        expect(out.status).toBe(true);
        expect(out.data.action).toBe('draft');
        expect(out.data.markdown).toBe('# Launch plan\n\n- one\n- two');
        expect(out.data.html).toContain('Launch plan');
        expect(out.data.html).toContain('<li>');
        expect(out.data.previewText).toContain('Launch plan');
        expect(out.data.blocks).toBeTruthy();
    });

    it('defaults to a draft when no action is given', async () => {
        answer('{"markdown":"Text"}');
        expect((await pageAi.composePage({})).data.action).toBe('draft');
    });

    it('sends the page text and charges the company and user', async () => {
        answer('{"markdown":"ok"}');
        await pageAi.composePage({ action: 'summarize', title: 'T', currentText: 'Body text', companyId: 'c1', userId: 'u1' });
        const sent = mockProvider.chat.mock.calls[0][0];
        expect(sent.messages[0].content).toContain('Body text');
        expect(sent.spend).toEqual({ feature: 'page_compose', companyId: 'c1', userId: 'u1' });
        expect(sent.jsonMode).toBe(true);
    });

    it('cuts a very long body at 12000 characters and a long title at 200', async () => {
        answer('{"markdown":"ok"}');
        await pageAi.composePage({ action: 'rewrite', title: 't'.repeat(500), currentText: 'b'.repeat(20000) });
        const prompt = mockProvider.chat.mock.calls[0][0].messages[0].content;
        expect(prompt).toContain(`${'t'.repeat(200)}…`);
        expect(prompt).not.toContain('t'.repeat(201));
        expect(prompt).toContain(`${'b'.repeat(12000)}…`);
        expect(prompt).not.toContain('b'.repeat(12001));
    });

    it('ignores a title or body that is not text', async () => {
        answer('{"markdown":"ok"}');
        await pageAi.composePage({ action: 'draft', title: 42, currentText: { a: 1 } });
        const prompt = mockProvider.chat.mock.calls[0][0].messages[0].content;
        expect(prompt).toContain('Title: (untitled)');
        expect(prompt).toContain('Current page body: (empty)');
    });

    it('reports a provider error with its message', async () => {
        mockProvider.chat.mockRejectedValue(new Error('rate limited'));
        expect(await pageAi.composePage({ action: 'draft' })).toEqual({ status: false, reason: 'rate limited' });
    });

    it('reports an empty answer', async () => {
        answer('   ');
        expect(await pageAi.composePage({ action: 'draft' })).toEqual({ status: false, reason: 'The model returned empty page content.' });
        mockProvider.chat.mockResolvedValue(null);
        expect((await pageAi.composePage({ action: 'draft' })).status).toBe(false);
    });

    it.failing('does not leave its 120 second timeout running after the model has answered', async () => {
        answer('{"markdown":"ok"}');
        await pageAi.composePage({ action: 'draft' });
        expect(jest.getTimerCount()).toBe(0);
    });

    it('does not let model markup through as html', async () => {
        answer('{"markdown":"Hello <script>alert(1)</script> world"}');
        const out = await pageAi.composePage({ action: 'draft' });
        expect(out.status).toBe(true);
        expect(out.data.html).not.toMatch(/<script/i);
    });
});

describe('isAiConfigured', () => {
    it('follows the provider factory', () => {
        mockFactory.isAnyProviderConfigured.mockReturnValue(false);
        expect(pageAi.isAiConfigured()).toBe(false);
        mockFactory.isAnyProviderConfigured.mockReturnValue(true);
        expect(pageAi.isAiConfigured()).toBe(true);
    });
});
