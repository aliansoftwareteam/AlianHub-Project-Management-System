/* Gate for scripts/plain-words.js: no English string a person reads uses a
   listed word, beyond the keys scripts/plain-words-baseline.json still holds. */
const fs = require('fs');
const { WORDS, BASELINE, wordsIn, scanSource, readBaseline, renderBaseline, compare } = require('../../scripts/plain-words');

describe('the word list', () => {
    test('names the plain word for every listed word', () => {
        expect(WORDS.filter((w) => !w.word || !w.say || !(w.pattern instanceof RegExp))).toEqual([]);
        expect(new Set(WORDS.map((w) => w.word)).size).toBe(WORDS.length);
    });

    test('finds a listed word whatever its case or number', () => {
        expect(wordsIn('Projects.x', 'Create New Sprint')).toEqual(['sprint']);
        expect(wordsIn('Projects.x', 'Move it to one of the sprints')).toEqual(['sprint']);
        expect(wordsIn('PlaceHolder.x', 'Enter directory name')).toEqual(['directory']);
        expect(wordsIn('Integrations.x', 'The payload is sent to the endpoint')).toEqual(['payload', 'endpoint']);
    });

    test('does not find a word inside another word', () => {
        expect(wordsIn('Projects.x', 'Sprinting ahead, nullify nothing, a cachet of parameters')).toEqual([]);
    });

    test('leaves a word alone where it names the thing itself', () => {
        expect(wordsIn('Scrum.start_sprint', 'Start sprint')).toEqual([]);
        expect(wordsIn('Org.tab_directory', 'Directory')).toEqual([]);
        expect(wordsIn('Org.x', 'Start sprint')).toEqual(['sprint']);
    });

    test('flags the name of a setting, but not a value the code fills in', () => {
        expect(wordsIn('Workflows.x', 'Set WORKFLOW_ENGINE=on to use workflows.')).toEqual(['setting name']);
        expect(wordsIn('Auth.x', 'Welcome to BRAND_NAME')).toEqual([]);
        expect(wordsIn('AiTask.x', 'Adding to: {sprint}')).toEqual([]);
        expect(wordsIn('Home.x', 'Read https://example.com/sprint for more')).toEqual([]);
    });

    test('skips values that are not text', () => {
        expect(wordsIn('Home.x', ['sprint'])).toEqual([]);
        expect(wordsIn('Home.x', 3)).toEqual([]);
    });
});

describe('plain words in en.js', () => {
    const baseline = readBaseline();
    const { added, stale } = compare(scanSource(), baseline);

    test('no string adds a listed word', () => {
        if (added.length) {
            const lines = added.map(({ key, word }) => `${key}: "${word}" — say "${WORDS.find((w) => w.word === word).say}"`);
            throw new Error(`${added.length} string(s) use a word a project manager would not know:\n  ${lines.join('\n  ')}\nReword the string. The baseline may only shrink.`);
        }
    });

    test('the baseline only holds keys that still break the rule', () => {
        if (stale.length) {
            const lines = stale.map(({ key, word }) => `${key}: "${word}"`);
            throw new Error(`${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} fixed or gone:\n  ${lines.join('\n  ')}\nRun node scripts/plain-words.js --prune`);
        }
    });

    test('the baseline is stored sorted, so two batches shrink different lines', () => {
        expect(fs.readFileSync(BASELINE, 'utf8')).toBe(renderBaseline(baseline));
    });
});
