const mockChat = jest.fn();
jest.mock('../Modules/AIProjectGenerator/llmProvider', () => ({
    getProvider: () => ({ name: 'fake', chat: (...a) => mockChat(...a) }),
    isAnyProviderConfigured: () => true,
}));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => []) }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async () => []), getActiveSkillSlugs: jest.fn(async () => []) }));
jest.mock('../Modules/AIProjectGenerator/orchestrator', () => ({ normalizePlanColors: (p) => p }));
jest.mock('../Modules/AIProjectGenerator/sseEmitter', () => ({ emit: jest.fn(), handleEvents: jest.fn(), COMPLETE_EVENT: 'complete' }));

const clarifier = require('../Modules/AIProjectGenerator/clarifier');
const ctrl = require('../Modules/AIProjectGenerator/controller');

const C = '6f0000000000000000000c01';
const POINTS = ['what_for_whom', 'done_when', 'existing', 'constraints', 'team'];
const TWO_LINE = 'An online store for our handmade ceramics.\nWe sell at markets today and want to sell online too.';

const cov = (met = []) => Object.fromEntries(POINTS.map((p) => [p, met.includes(p) ? 'met' : 'missing']));
const reply = (obj) => ({ content: JSON.stringify(obj), inputTokens: 10, outputTokens: 10, totalTokens: 20, model: 'fake-1' });
const question = (id, point, over = {}) => ({
    id, point, category: 'features', question: `Question about ${point}?`, rationale: 'r', required: true, hint: 'h',
    type: 'select_card', options: [{ value: 'a', label: 'A', description: 'x' }, { value: 'b', label: 'B' }], recommended: 'a', ...over,
});
const isCoverageCall = (opts) => /completeness reviewer/i.test(opts.systemPrompt);
const isClarifyCall = (opts) => /Senior product consultant/i.test(opts.systemPrompt);

function primeProvider({ coverage, questions, understanding = 'heard' }) {
    mockChat.mockImplementation(async (opts) => {
        if (isCoverageCall(opts)) return reply({ coverage, notes: {} });
        if (isClarifyCall(opts)) return reply({ understanding, questions });
        throw new Error(`unexpected call: ${opts.systemPrompt.slice(0, 40)}`);
    });
}
const calls = (pick) => mockChat.mock.calls.map(([opts]) => opts).filter(pick);
const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (body) => ({ headers: { companyid: C }, aud: [C], body, uid: 'u1' });

beforeEach(() => mockChat.mockReset());

describe('planRound (pure rules)', () => {
    it('asks about nothing when every point is met', () => {
        expect(clarifier.planRound({ coverage: cov(POINTS) })).toEqual({ round: 1, askPoints: [], maxQuestions: 0 });
    });

    it('caps round 1 at three questions, in plan-priority order', () => {
        const r = clarifier.planRound({ coverage: cov([]) });
        expect(r).toEqual({ round: 1, askPoints: ['what_for_whom', 'done_when', 'constraints'], maxQuestions: 3 });
    });

    it('never re-asks a point the owner skipped or does not know, and derives round 2 from earlier answers', () => {
        const previousAnswers = [
            { id: 'q1', point: 'done_when', question: 'a?', answer: 'x' },
            { id: 'q2', point: 'constraints', question: 'b?', unknown: true },
            { id: 'q3', point: 'existing', question: 'c?', skipped: true },
        ];
        const r = clarifier.planRound({ coverage: cov(['what_for_whom', 'done_when']), previousAnswers });
        expect(r).toEqual({ round: 2, askPoints: ['team'], maxQuestions: 1 });
    });

    it('caps the total at six across rounds and asks nothing after round 2', () => {
        const six = Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, point: 'team', question: 'x?', answer: 'vague' }));
        expect(clarifier.planRound({ coverage: cov([]), previousAnswers: six }).askPoints).toEqual([]);
        const four = six.slice(0, 4);
        expect(clarifier.planRound({ coverage: cov([]), previousAnswers: four }).maxQuestions).toBe(2);
        expect(clarifier.planRound({ coverage: cov([]), previousAnswers: [], round: 3 }).askPoints).toEqual([]);
    });
});

describe('generateClarifyingQuestions', () => {
    it('returns zero questions for a brief that meets all five points, without a clarify call', async () => {
        primeProvider({ coverage: cov(POINTS), questions: [question('x', 'team')] });
        const out = await clarifier.generateClarifyingQuestions({ description: 'complete brief' });
        expect(out.questions).toEqual([]);
        expect(out.coverage).toEqual(cov(POINTS));
        expect(out).toMatchObject({ round: 1, maxRounds: 2 });
        expect(calls(isClarifyCall)).toHaveLength(0);
        expect(calls(isCoverageCall)).toHaveLength(1);
    });

    it('asks at most three questions about missing points only for a two-line brief, each with point and allowUnknown', async () => {
        primeProvider({
            coverage: cov(['what_for_whom']),
            questions: [
                question('q-done', 'done_when'),
                question('q-cons', 'constraints'),
                question('q-exist', 'existing'),
                question('q-team', 'team'),
                question('q-what', 'what_for_whom'),
            ],
        });
        const out = await clarifier.generateClarifyingQuestions({ description: TWO_LINE });
        expect(out.questions.length).toBeLessThanOrEqual(3);
        expect(out.questions.map((q) => q.point)).toEqual(['done_when', 'constraints', 'existing']);
        out.questions.forEach((q) => expect(q).toMatchObject({ allowUnknown: true, required: false }));
        expect(out.questions[0].options).toHaveLength(2);

        const [clarifyCall] = calls(isClarifyCall);
        const userMessage = clarifyCall.messages[0].content;
        expect(userMessage).toMatch(/at most 3 questions/);
        expect(userMessage).toMatch(/done_when, constraints, existing/);
        expect(userMessage).toContain('what_for_whom (What and for whom): met');
    });

    it('drops a second question on the same point', async () => {
        primeProvider({ coverage: cov(['what_for_whom', 'existing', 'team']), questions: [question('a', 'done_when'), question('b', 'done_when'), question('c', 'constraints')] });
        const out = await clarifier.generateClarifyingQuestions({ description: TWO_LINE });
        expect(out.questions.map((q) => q.id)).toEqual(['a', 'c']);
    });

    it('round 2 asks only about points still missing and never re-asks an unknown, so the total stays at six or fewer', async () => {
        const previousAnswers = [
            { id: 'q-done', point: 'done_when', question: 'Done?', answer: 'order-pay-ship' },
            { id: 'q-cons', point: 'constraints', question: 'When?', unknown: true },
            { id: 'q-exist', point: 'existing', question: 'Have?', skipped: true },
        ];
        primeProvider({ coverage: cov(['what_for_whom', 'done_when']), questions: [question('q-team', 'team'), question('q-cons-2', 'constraints')] });
        const out = await clarifier.generateClarifyingQuestions({ description: TWO_LINE, previousAnswers });
        expect(out).toMatchObject({ round: 2, maxRounds: 2 });
        expect(out.questions.map((q) => q.point)).toEqual(['team']);
        expect(previousAnswers.length + out.questions.length).toBeLessThanOrEqual(6);

        const [coverageCall] = calls(isCoverageCall);
        expect(coverageCall.messages[0].content).toContain('does not know yet');
        const [clarifyCall] = calls(isClarifyCall);
        expect(clarifyCall.messages[0].content).toContain('Round 1 answers');
    });
});

describe('POST /api/v1/ai/project/clarify', () => {
    it('returns coverage, round and maxRounds alongside the questions, top-level and under data', async () => {
        primeProvider({ coverage: cov(['what_for_whom', 'existing', 'team']), questions: [question('q-done', 'done_when'), question('q-cons', 'constraints')] });
        const r = res();
        await ctrl.clarify(req({ description: TWO_LINE }), r);
        expect(r.code).toBe(200);
        expect(r.body.status).toBe(true);
        expect(r.body).toMatchObject({ round: 1, maxRounds: 2, coverage: cov(['what_for_whom', 'existing', 'team']) });
        expect(r.body.questions).toHaveLength(2);
        expect(r.body.data).toMatchObject({ round: 1, maxRounds: 2, understanding: 'heard' });
        expect(r.body.data.questions.map((q) => q.point)).toEqual(['done_when', 'constraints']);
    });

    it('forwards previousAnswers with their point and unknown flags into round 2', async () => {
        primeProvider({ coverage: cov(['what_for_whom', 'done_when', 'existing']), questions: [question('q-team', 'team')] });
        const r = res();
        await ctrl.clarify(req({
            description: TWO_LINE,
            previousAnswers: [
                { id: 'q-done', point: 'done_when', question: 'Done?', answer: 'x' },
                { id: 'q-cons', point: 'constraints', question: 'When?', unknown: true },
                { id: 'bad', point: 'not-a-point', question: 'Junk?', answer: 'y' },
            ],
        }), r);
        expect(r.body).toMatchObject({ round: 2 });
        expect(r.body.questions.map((q) => q.point)).toEqual(['team']);
        const [coverageCall] = calls(isCoverageCall);
        expect(coverageCall.messages[0].content).toContain('[constraints] When?');
        expect(coverageCall.messages[0].content).toContain('[misc] Junk?');
    });

    it('returns an empty question list once every point is met', async () => {
        primeProvider({ coverage: cov(POINTS), questions: [] });
        const r = res();
        await ctrl.clarify(req({ description: 'A brief that already covers every point in full detail.' }), r);
        expect(r.body.questions).toEqual([]);
        expect(r.body.data.coverage).toEqual(cov(POINTS));
    });
});
