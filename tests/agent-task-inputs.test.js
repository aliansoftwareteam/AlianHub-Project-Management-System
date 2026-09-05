const { inputsOf, MIN_BRIEF_CHARS } = require('../Modules/Agents/taskInputs');

describe('what a task carries for the router', () => {
    it('finds a PR from a typed link, an untyped github link, or the description', () => {
        expect(inputsOf({ links: [{ kind: 'pr', url: 'https://github.com/a/b/pull/7' }] }).prUrl).toBe('https://github.com/a/b/pull/7');
        expect(inputsOf({ links: [{ kind: 'url', url: 'https://gitlab.com/a/b/-/merge_requests/3' }] }).prUrl).toBe('https://gitlab.com/a/b/-/merge_requests/3');
        expect(inputsOf({ description: '<p>see https://github.com/a/b/pull/8/files</p>' }).prUrl).toBe('https://github.com/a/b/pull/8/files');
        expect(inputsOf({ TaskName: 'Fix login' }).prUrl).toBeNull();
    });

    it('a public URL is not a PR and not a private host', () => {
        expect(inputsOf({ TaskName: 'Review https://example.com/pricing' }).publicUrl).toBe('https://example.com/pricing');
        expect(inputsOf({ TaskName: 'Review http://localhost:4000/ai' }).publicUrl).toBeNull();
        expect(inputsOf({ TaskName: 'Review http://192.168.1.4/' }).publicUrl).toBeNull();
        expect(inputsOf({ links: [{ kind: 'pr', url: 'https://github.com/a/b/pull/7' }] }).publicUrl).toBeNull();
        expect(inputsOf({ links: [{ kind: 'url', url: 'https://staging.example.com' }] }).publicUrl).toBe('https://staging.example.com');
    });

    it('measures the brief as plain text', () => {
        expect(inputsOf({ description: '<p>short</p>' }).briefChars).toBe(5);
        expect(inputsOf({ rawDescription: 'x'.repeat(MIN_BRIEF_CHARS) }).briefChars).toBe(MIN_BRIEF_CHARS);
        expect(inputsOf({}).briefChars).toBe(0);
    });
});
