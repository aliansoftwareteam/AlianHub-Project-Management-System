const fs = require('fs');
const os = require('os');
const path = require('path');

const kc = require('../scripts/knowledge-compare');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000011';
const MEMBER = '6f0000000000000000000022';
const TASK_18 = '6f00000000000000000000a8';
const TASK_7 = '6f00000000000000000000a7';
const COMMENT = '0000000000000000f4825e79';
const PAGE = '6f00000000000000000000b1';
const PRIVATE_PAGE = '6f00000000000000000000b2';

const passage = (sourceType, sourceId, over = {}) => ({ id: `${sourceType}:${sourceId}`, sourceType, sourceId, ...over });

const fakeStore = () => ({
    ownerOf: jest.fn(async () => OWNER),
    userIdFor: jest.fn(async (who) => ({ 'member@example.com': MEMBER, [MEMBER]: MEMBER }[who] || null)),
    taskIdForKey: jest.fn(async (key) => ({ 'AP-18': TASK_18, 'AP-7': TASK_7 }[key] || null)),
});

/* Answers by question text and mode; the caller is recorded so access rows can be checked. */
const fakeRetrieve = (answers) => jest.fn(async ({ query, mode }) => {
    const answer = answers[query];
    if (answer instanceof Error) throw answer;
    const passages = typeof answer === 'function' ? answer(mode) : (answer || []);
    return { passages, backend: mode === 'hybrid' ? 'text+local' : 'text' };
});

const TABLE = [
    '# Held-out questions',
    '',
    'Some notes the owner keeps above the table.',
    '',
    '| # | Question | Expected source | Fact |',
    '|---|---|---|---|',
    '| 1 | Why did we move the release? | AP-18 · f4825e79 | The vendor slipped |',
    '| 2 | What is the onboarding checklist? | `' + PAGE + '` | Five steps |',
    '| 3 | Who owns billing? | AP-7 | Priya |',
    '',
];

const write = (name, text) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-compare-'));
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return file;
};

describe('parsing the expected source', () => {
    it('reads a task key with the trailing characters of a comment id', () => {
        expect(kc.parseExpected('AP-18 · f4825e79')).toEqual([{ taskKey: 'AP-18', idSuffix: 'f4825e79' }]);
    });

    it('reads a full 24-hex id, with or without backticks', () => {
        expect(kc.parseExpected(`\`${PAGE}\``)).toEqual([{ id: PAGE }]);
        expect(kc.parseExpected(PAGE.toUpperCase())).toEqual([{ id: PAGE }]);
    });

    it('reads a bare task key and typed ids', () => {
        expect(kc.parseExpected('AP-7')).toEqual([{ taskKey: 'AP-7' }]);
        expect(kc.parseExpected(`page:${PAGE}`)).toEqual([{ pageId: PAGE }]);
        expect(kc.parseExpected('comment:f4825e79')).toEqual([{ commentId: 'f4825e79' }]);
    });

    it('reads alternatives, any one of which counts', () => {
        expect(kc.parseExpected(`AP-7; page:${PAGE}`)).toEqual([{ taskKey: 'AP-7' }, { pageId: PAGE }]);
        expect(kc.parseExpected(`AP-7 or ${PAGE}`)).toEqual([{ taskKey: 'AP-7' }, { id: PAGE }]);
    });

    it('refuses what it cannot read rather than guessing', () => {
        expect(() => kc.parseExpected('the onboarding page')).toThrow(/cannot read/i);
        expect(() => kc.parseExpected('')).toThrow(/no expected source/i);
        expect(() => kc.parseExpected('abc')).toThrow(/cannot read/i);
    });
});

describe('parsing the question file', () => {
    it('reads the Markdown table and ignores the prose around it', () => {
        const questions = kc.parseQuestions(TABLE.join('\n'), { file: 'q.md' });
        expect(questions).toEqual([
            { n: '1', question: 'Why did we move the release?', expected: [{ taskKey: 'AP-18', idSuffix: 'f4825e79' }], fact: 'The vendor slipped', asUser: null, expect: 'found' },
            { n: '2', question: 'What is the onboarding checklist?', expected: [{ id: PAGE }], fact: 'Five steps', asUser: null, expect: 'found' },
            { n: '3', question: 'Who owns billing?', expected: [{ taskKey: 'AP-7' }], fact: 'Priya', asUser: null, expect: 'found' },
        ]);
    });

    it('reads the optional access columns; an access row expects the source hidden unless it says otherwise', () => {
        const text = [
            '| # | Question | Expected source | As user | Expect |',
            '|---|---|---|---|---|',
            `| 1 | Private plan? | page:${PRIVATE_PAGE} | member@example.com | |`,
            `| 2 | Shared plan? | page:${PAGE} | member@example.com | visible |`,
        ].join('\n');
        const [hidden, visible] = kc.parseQuestions(text, { file: 'q.md' });
        expect(hidden).toMatchObject({ asUser: 'member@example.com', expect: 'hidden' });
        expect(visible).toMatchObject({ asUser: 'member@example.com', expect: 'found' });
    });

    it('names the row it cannot read', () => {
        const text = ['| # | Question | Expected source |', '|---|---|---|', '| 4 | Q? | somewhere |'].join('\n');
        expect(() => kc.parseQuestions(text, { file: 'q.md' })).toThrow(/row 4/);
    });

    it('refuses a file with no question table', () => {
        expect(() => kc.parseQuestions('# nothing here', { file: 'q.md' })).toThrow(/no table/i);
    });

    it('reads the JSON form', () => {
        const json = JSON.stringify([
            { question: 'Why did we move the release?', expected: { taskKey: 'AP-18', commentId: 'f4825e79' } },
            { question: 'Private plan?', expected: { pageId: PRIVATE_PAGE }, asUser: MEMBER },
            { question: 'Either?', expected: 'AP-7 or ' + PAGE },
        ]);
        expect(kc.parseQuestions(json, { file: 'q.json' })).toEqual([
            { n: '1', question: 'Why did we move the release?', expected: [{ taskKey: 'AP-18', commentId: 'f4825e79' }], fact: '', asUser: null, expect: 'found' },
            { n: '2', question: 'Private plan?', expected: [{ pageId: PRIVATE_PAGE }], fact: '', asUser: MEMBER, expect: 'hidden' },
            { n: '3', question: 'Either?', expected: [{ taskKey: 'AP-7' }, { id: PAGE }], fact: '', asUser: null, expect: 'found' },
        ]);
    });

    it('refuses a JSON row without a question or a source', () => {
        expect(() => kc.parseQuestions(JSON.stringify([{ question: 'Q?' }]), { file: 'q.json' })).toThrow(/question 1/);
        expect(() => kc.parseQuestions(JSON.stringify([{ expected: { taskKey: 'AP-1' } }]), { file: 'q.json' })).toThrow(/question 1/);
    });
});

describe('arguments', () => {
    it('takes the defaults the owner expects', () => {
        expect(kc.parseArgs(['--questions', 'q.md', '--company', C])).toEqual({
            questions: 'q.md', company: C, mode: 'both', k: 3, minHit: 0.8, json: null, as: null, allowDevDb: false,
        });
    });

    it('reads every option', () => {
        expect(kc.parseArgs(['--questions', 'q.md', '--company', C, '--mode', 'lexical', '--k', '5', '--min-hit', '0.9', '--json', 'out.json', '--as', MEMBER, '--allow-dev-db'])).toEqual({
            questions: 'q.md', company: C, mode: 'lexical', k: 5, minHit: 0.9, json: 'out.json', as: MEMBER, allowDevDb: true,
        });
    });

    it('refuses what is missing or malformed', () => {
        expect(() => kc.parseArgs(['--company', C])).toThrow(/--questions/);
        expect(() => kc.parseArgs(['--questions', 'q.md'])).toThrow(/--company/);
        expect(() => kc.parseArgs(['--questions', 'q.md', '--company', 'acme'])).toThrow(/--company/);
        expect(() => kc.parseArgs(['--questions', 'q.md', '--company', C, '--mode', 'vector'])).toThrow(/--mode/);
        expect(() => kc.parseArgs(['--questions', 'q.md', '--company', C, '--k', '0'])).toThrow(/--k/);
        expect(() => kc.parseArgs(['--questions', 'q.md', '--company', C, '--min-hit', '2'])).toThrow(/--min-hit/);
        expect(() => kc.parseArgs(['--questions', 'q.md', '--company', C, '--bogus'])).toThrow(/--bogus/);
    });
});

describe('scoring', () => {
    const questions = kc.parseQuestions(TABLE.join('\n'), { file: 'q.md' });
    const run = (answers, over = {}) => kc.runComparison({
        questions, companyId: C, modes: ['lexical'], k: 3, minHit: 0.8, retrieve: fakeRetrieve(answers), store: fakeStore(), ...over,
    });

    it('records the rank of the expected source, a comment matched by its trailing characters', async () => {
        const result = await run({
            'Why did we move the release?': [passage('task', TASK_7), passage('comment', COMMENT)],
            'What is the onboarding checklist?': [passage('page', PAGE)],
            'Who owns billing?': [passage('page', PAGE), passage('page', PRIVATE_PAGE), passage('task', TASK_7)],
        });
        expect(result.questions.map((q) => q.results.lexical)).toEqual([
            expect.objectContaining({ status: 'hit', rank: 2 }),
            expect.objectContaining({ status: 'hit', rank: 1 }),
            expect.objectContaining({ status: 'hit', rank: 3 }),
        ]);
        expect(result.summary.lexical).toMatchObject({ found: 3, hits: 3, hitAtK: 1 });
        expect(result.summary.lexical.mrr).toBeCloseTo((1 / 2 + 1 + 1 / 3) / 3, 6);
    });

    it('counts a source below k as a miss, with its rank kept for the report', async () => {
        const result = await run({
            'Why did we move the release?': [passage('task', TASK_7), passage('page', PAGE), passage('page', PRIVATE_PAGE), passage('comment', COMMENT)],
            'What is the onboarding checklist?': [],
            'Who owns billing?': [passage('task', TASK_7)],
        });
        expect(result.questions[0].results.lexical).toMatchObject({ status: 'miss', rank: 4, rr: 0 });
        expect(result.questions[1].results.lexical).toMatchObject({ status: 'miss', rank: null, rr: 0 });
        expect(result.summary.lexical).toMatchObject({ found: 3, hits: 1 });
        expect(result.summary.lexical.hitAtK).toBeCloseTo(1 / 3, 6);
        expect(result.summary.lexical.mrr).toBeCloseTo(1 / 3, 6);
    });

    it('matches a task key to the task and to passages attached to it, and nothing else', async () => {
        const result = await run({
            'Why did we move the release?': [passage('comment', '6f00000000000000000000ffff', { taskId: TASK_18 })],
            'What is the onboarding checklist?': [passage('page', PAGE)],
            'Who owns billing?': [passage('file', 'x1', { taskId: TASK_7 })],
        });
        expect(result.questions[0].results.lexical.status).toBe('miss');
        expect(result.questions[2].results.lexical).toMatchObject({ status: 'hit', rank: 1 });
    });

    it('asks as the company owner by default, and as --as when given', async () => {
        const retrieve = fakeRetrieve({});
        await run({}, { retrieve });
        expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({ companyId: C, caller: { kind: 'user', userId: OWNER }, mode: 'lexical' }));

        const other = fakeRetrieve({});
        await run({}, { retrieve: other, as: 'member@example.com' });
        expect(other).toHaveBeenCalledWith(expect.objectContaining({ caller: { kind: 'user', userId: MEMBER } }));
    });

    it('asks for at least as many passages as Ask itself reads, so a leak below k is still seen', async () => {
        const retrieve = fakeRetrieve({});
        await run({}, { retrieve });
        expect(retrieve.mock.calls[0][0].limit).toBeGreaterThanOrEqual(kc.ASK_WINDOW);
    });

    it('runs each mode on every question and reports them side by side', async () => {
        const result = await run({
            'Why did we move the release?': (mode) => (mode === 'hybrid' ? [passage('comment', COMMENT)] : []),
            'What is the onboarding checklist?': [passage('page', PAGE)],
            'Who owns billing?': [passage('task', TASK_7)],
        }, { modes: ['lexical', 'hybrid'] });
        expect(result.questions[0].results).toEqual({
            lexical: expect.objectContaining({ status: 'miss', backend: 'text' }),
            hybrid: expect.objectContaining({ status: 'hit', rank: 1, backend: 'text+local' }),
        });
        expect(result.summary.lexical.pass).toBe(false);
        expect(result.summary.hybrid.pass).toBe(true);
        expect(result.pass).toBe(false);
        const report = kc.formatReport(result);
        expect(report).toMatch(/lexical/);
        expect(report).toMatch(/hybrid/);
        expect(report).toMatch(/FAIL/);
    });
});

describe('access rows', () => {
    const questions = kc.parseQuestions([
        '| # | Question | Expected source | As user |',
        '|---|---|---|---|',
        '| 1 | What does the shared plan say? | ' + PAGE + ' | |',
        `| 2 | What is in the private plan? | page:${PRIVATE_PAGE} | member@example.com |`,
    ].join('\n'), { file: 'q.md' });

    it('asks an access row as its user and passes when the private source is not returned', async () => {
        const retrieve = fakeRetrieve({
            'What does the shared plan say?': [passage('page', PAGE)],
            'What is in the private plan?': [passage('page', PAGE)],
        });
        const result = await kc.runComparison({ questions, companyId: C, modes: ['lexical'], k: 3, minHit: 0.8, retrieve, store: fakeStore() });
        expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({ query: 'What is in the private plan?', caller: { kind: 'user', userId: MEMBER } }));
        expect(result.questions[1].results.lexical).toMatchObject({ status: 'hidden', rank: null });
        expect(result.summary.lexical).toMatchObject({ found: 1, hits: 1, hidden: 1, leaks: 0, pass: true });
        expect(result.pass).toBe(true);
    });

    it('fails the whole run on a leak, even one below k and even when every hit lands', async () => {
        const result = await kc.runComparison({
            questions, companyId: C, modes: ['lexical'], k: 1, minHit: 0.8, store: fakeStore(),
            retrieve: fakeRetrieve({
                'What does the shared plan say?': [passage('page', PAGE)],
                'What is in the private plan?': [passage('page', PAGE), passage('task', TASK_7), passage('page', PRIVATE_PAGE)],
            }),
        });
        expect(result.questions[1].results.lexical).toMatchObject({ status: 'leak', rank: 3 });
        expect(result.summary.lexical).toMatchObject({ hitAtK: 1, leaks: 1, pass: false });
        expect(result.pass).toBe(false);
        expect(result.reasons.join(' ')).toMatch(/leak/i);
        expect(kc.formatReport(result)).toMatch(/LEAK/);
    });

    it('fails an access row whose user cannot be found instead of asking as someone else', async () => {
        const store = fakeStore();
        store.userIdFor.mockResolvedValue(null);
        const retrieve = fakeRetrieve({ 'What does the shared plan say?': [passage('page', PAGE)] });
        const result = await kc.runComparison({ questions, companyId: C, modes: ['lexical'], k: 3, minHit: 0.8, retrieve, store });
        expect(result.questions[1].results.lexical).toMatchObject({ status: 'error' });
        expect(retrieve).not.toHaveBeenCalledWith(expect.objectContaining({ query: 'What is in the private plan?' }));
        expect(result.pass).toBe(false);
    });
});

describe('the verdict', () => {
    const questions = kc.parseQuestions(TABLE.join('\n'), { file: 'q.md' });
    const answers = (hits) => ({
        'Why did we move the release?': hits >= 1 ? [passage('comment', COMMENT)] : [],
        'What is the onboarding checklist?': hits >= 2 ? [passage('page', PAGE)] : [],
        'Who owns billing?': hits >= 3 ? [passage('task', TASK_7)] : [],
    });
    const verdict = (hits, minHit) => kc.runComparison({ questions, companyId: C, modes: ['lexical'], k: 3, minHit, retrieve: fakeRetrieve(answers(hits)), store: fakeStore() });

    it('passes at the threshold and fails just under it', async () => {
        expect((await verdict(3, 0.8)).pass).toBe(true);
        expect((await verdict(2, 0.8)).pass).toBe(false);
        expect((await verdict(2, 0.66)).pass).toBe(true);
        expect((await verdict(2, 2 / 3)).pass).toBe(true);
    });

    it('states the threshold it judged against', async () => {
        const result = await verdict(2, 0.8);
        expect(result.reasons.join(' ')).toMatch(/0\.67.*0\.8|67%.*80%/);
        expect(kc.formatReport(result)).toMatch(/80%/);
    });

    it('fails a run where a question errored or a task key did not resolve', async () => {
        const errored = await kc.runComparison({
            questions, companyId: C, modes: ['lexical'], k: 3, minHit: 0.1, store: fakeStore(),
            retrieve: fakeRetrieve({ ...answers(3), 'Who owns billing?': new Error('boom') }),
        });
        expect(errored.questions[2].results.lexical).toMatchObject({ status: 'error', error: 'boom' });
        expect(errored.pass).toBe(false);

        const store = fakeStore();
        store.taskIdForKey.mockImplementation(async (key) => (key === 'AP-7' ? null : TASK_18));
        const unresolved = await kc.runComparison({ questions, companyId: C, modes: ['lexical'], k: 3, minHit: 0.1, retrieve: fakeRetrieve(answers(3)), store });
        expect(unresolved.questions[2].results.lexical).toMatchObject({ status: 'error', error: expect.stringMatching(/AP-7/) });
        expect(unresolved.pass).toBe(false);
    });

    it('fails a run in which the read-only guard stopped a write', async () => {
        const result = await kc.runComparison({
            questions, companyId: C, modes: ['lexical'], k: 3, minHit: 0.8, retrieve: fakeRetrieve(answers(3)), store: fakeStore(),
            blockedWrites: () => ['insertOne on aiusages'],
        });
        expect(result.pass).toBe(false);
        expect(result.reasons.join(' ')).toMatch(/write/i);
    });
});

describe('JSON output', () => {
    it('has a stable shape', async () => {
        const questions = kc.parseQuestions(TABLE.join('\n'), { file: 'q.md' });
        const result = await kc.runComparison({
            questions, companyId: C, modes: ['lexical', 'hybrid'], k: 3, minHit: 0.8, store: fakeStore(),
            retrieve: fakeRetrieve({ 'Why did we move the release?': [passage('comment', COMMENT)], 'What is the onboarding checklist?': [passage('page', PAGE)], 'Who owns billing?': [passage('task', TASK_7)] }),
        });
        const json = JSON.parse(JSON.stringify(kc.toJson(result)));
        expect(Object.keys(json).sort()).toEqual(['asUser', 'blockedWrites', 'companyId', 'generatedAt', 'k', 'minHit', 'modes', 'pass', 'questions', 'reasons', 'summary'].sort());
        expect(json).toMatchObject({ companyId: C, k: 3, minHit: 0.8, modes: ['lexical', 'hybrid'], asUser: OWNER, pass: true, reasons: [], blockedWrites: [] });
        expect(json.summary.lexical).toEqual({ mode: 'lexical', found: 3, hits: 3, hitAtK: 1, mrr: 1, hidden: 0, leaks: 0, errors: 0, backends: { text: 3 }, pass: true });
        expect(json.questions[0]).toEqual({
            n: '1', question: 'Why did we move the release?', fact: 'The vendor slipped', expect: 'found', asUser: null,
            expected: [{ taskKey: 'AP-18', idSuffix: 'f4825e79' }],
            results: {
                lexical: { status: 'hit', rank: 1, rr: 1, backend: 'text', top: [`comment:${COMMENT}`] },
                hybrid: { status: 'hit', rank: 1, rr: 1, backend: 'text+local', top: [`comment:${COMMENT}`] },
            },
        });
    });
});

describe('the database guard', () => {
    it('reads the port of every host in the connection string', () => {
        expect(kc.mongoPorts('mongodb://localhost:27017')).toEqual([27017]);
        expect(kc.mongoPorts('mongodb://localhost')).toEqual([27017]);
        expect(kc.mongoPorts('mongodb://user:p%40ss@127.0.0.1:27018/?replicaSet=rs')).toEqual([27018]);
        expect(kc.mongoPorts('mongodb://a:27019,b:27017')).toEqual([27019, 27017]);
        expect(kc.mongoPorts('mongodb+srv://cluster.example.net')).toEqual([]);
    });

    it('refuses the dev database on 27017 without --allow-dev-db', () => {
        expect(() => kc.refuseDevDb('mongodb://localhost:27017', false)).toThrow(/--allow-dev-db/);
        expect(() => kc.refuseDevDb('mongodb://localhost', false)).toThrow(/--allow-dev-db/);
        expect(() => kc.refuseDevDb('mongodb://localhost:27017', true)).not.toThrow();
        expect(() => kc.refuseDevDb('mongodb://localhost:27148', false)).not.toThrow();
        expect(() => kc.refuseDevDb('', false)).toThrow(/MONGODB_URL/);
    });

    it('stops at the guard before it connects', async () => {
        const file = write('q.md', TABLE.join('\n'));
        const connect = jest.fn();
        const errors = [];
        const code = await kc.main(['--questions', file, '--company', C], { env: { MONGODB_URL: 'mongodb://localhost:27017' }, connect, log: () => {}, error: (m) => errors.push(m) });
        expect(code).toBe(2);
        expect(connect).not.toHaveBeenCalled();
        expect(errors.join('\n')).toMatch(/--allow-dev-db/);
    });

    it('runs against 27017 once the flag is given, and writes the JSON report', async () => {
        const file = write('q.md', TABLE.join('\n'));
        const out = path.join(path.dirname(file), 'out.json');
        const close = jest.fn(async () => {});
        const connect = jest.fn(async () => ({
            store: fakeStore(),
            retrieve: fakeRetrieve({ 'Why did we move the release?': [passage('comment', COMMENT)], 'What is the onboarding checklist?': [passage('page', PAGE)], 'Who owns billing?': [passage('task', TASK_7)] }),
            blockedWrites: () => [],
            close,
        }));
        const lines = [];
        const code = await kc.main(['--questions', file, '--company', C, '--allow-dev-db', '--json', out], { env: { MONGODB_URL: 'mongodb://localhost:27017' }, connect, log: (m) => lines.push(m), error: () => {} });
        expect(code).toBe(0);
        expect(connect).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalled();
        expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toMatchObject({ pass: true, modes: ['lexical', 'hybrid'] });
        expect(lines.join('\n')).toMatch(/PASS/);
    });

    it('exits 1 on a failing comparison', async () => {
        const file = write('q.md', TABLE.join('\n'));
        const connect = async () => ({ store: fakeStore(), retrieve: fakeRetrieve({}), blockedWrites: () => [], close: async () => {} });
        expect(await kc.main(['--questions', file, '--company', C, '--mode', 'lexical'], { env: { MONGODB_URL: 'mongodb://localhost:27148' }, connect, log: () => {}, error: () => {} })).toBe(1);
    });
});

describe('the read-only guard', () => {
    it('throws on every write method of the driver and records it', async () => {
        class Collection {
            constructor(name) { this.collectionName = name; }
            async find() { return 'rows'; }
            async insertOne() { return 'written'; }
            async updateMany() { return 'written'; }
            async bulkWrite() { return 'written'; }
            async findOneAndUpdate() { return 'written'; }
        }
        class Db { async createCollection() { return 'created'; } }
        const guard = kc.installWriteGuard({ Collection, Db });
        const c = new Collection('aiusages');
        await expect(c.find()).resolves.toBe('rows');
        await expect(c.insertOne({})).rejects.toThrow(/read-only/);
        await expect(c.updateMany({}, {})).rejects.toThrow(/read-only/);
        await expect(c.bulkWrite([])).rejects.toThrow(/read-only/);
        await expect(c.findOneAndUpdate({}, {})).rejects.toThrow(/read-only/);
        await expect(new Db().createCollection('x')).rejects.toThrow(/read-only/);
        expect(guard.attempts()).toEqual(['insertOne on aiusages', 'updateMany on aiusages', 'bulkWrite on aiusages', 'findOneAndUpdate on aiusages', 'createCollection']);
    });
});
