const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { deriveBuildInfo, renderLog } = require('../scripts/build-info');
const { resolveBuildInfo } = require('../Config/buildInfo');

const GIT_ENV = {
    ...process.env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Build Test',
    GIT_AUTHOR_EMAIL: 'build@example.com',
    GIT_COMMITTER_NAME: 'Build Test',
    GIT_COMMITTER_EMAIL: 'build@example.com',
};

const created = [];
afterAll(() => created.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alianhub-build-info-'));
    created.push(dir);
    return dir;
}

function makeRepo({ tag = true } = {}) {
    const dir = tempDir();
    const git = (...args) => execFileSync('git', args, { cwd: dir, env: GIT_ENV, stdio: 'pipe', encoding: 'utf8' }).trim();
    const commit = (subject, body) => {
        fs.appendFileSync(path.join(dir, 'changes.txt'), `${subject}\n`);
        git('add', '.');
        git('commit', '-q', '-m', subject, ...(body ? ['-m', body] : []));
    };
    git('init', '-q', '-b', 'beta');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.2.3', repository: { url: 'git+https://github.com/o/r.git' } }));
    commit('chore: initial release');
    if (tag) git('tag', 'v1.2.3');
    return { dir, git, commit };
}

describe('build info derived from git', () => {
    it('numbers every first-parent commit since the release tag and reads PRs from merges and squashes', () => {
        const { dir, git, commit } = makeRepo();
        commit('feat(x): add thing (#12)');
        git('checkout', '-q', '-b', 'feature');
        commit('fix(y): repair thing');
        git('checkout', '-q', 'beta');
        git('merge', '-q', '--no-ff', '-m', 'Merge pull request #13 from o/b', '-m', 'fix(y): repair thing', 'feature');
        commit('docs: note the thing');

        const info = deriveBuildInfo({ cwd: dir });
        expect(info).toMatchObject({ version: '1.3.0-beta.3', release: '1.2.3', base: '1.2.3', next: '1.3.0', channel: 'beta', build: 3, source: 'git', repoUrl: 'https://github.com/o/r' });
        expect(info.commit).toMatch(/^[0-9a-f]{8}$/);
        expect(info.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
        expect(info.entries.map(({ build, version, pr, title, type }) => ({ build, version, pr, title, type }))).toEqual([
            { build: 3, version: '1.3.0-beta.3', pr: null, title: 'docs: note the thing', type: 'docs' },
            { build: 2, version: '1.3.0-beta.2', pr: 13, title: 'fix(y): repair thing', type: 'fix' },
            { build: 1, version: '1.3.0-beta.1', pr: 12, title: 'feat(x): add thing', type: 'feat' },
        ]);
        expect(info.entries[0].commit).toBe(info.commit);
        expect(info.entries[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        const log = renderLog(info);
        expect(log).toContain('# Beta build log');
        expect(log).toContain('npm run version:log');
        expect(log).toContain('| Build | Version | Date | PR | Change |');
        expect(log).toContain('| 2 | 1.3.0-beta.2 |');
        expect(log).toContain('[#13](https://github.com/o/r/pull/13)');
        expect(log.indexOf('| 3 |')).toBeLessThan(log.indexOf('| 1 |'));
    });

    it('bumps the patch for a fix-only range, and keeps an earlier build label once a feat lands', () => {
        const { dir, commit } = makeRepo();
        commit('fix: repair a thing');
        expect(deriveBuildInfo({ cwd: dir })).toMatchObject({ version: '1.2.4-beta.1', next: '1.2.4' });
        commit('feat: add a thing');
        expect(deriveBuildInfo({ cwd: dir }).entries.map((e) => e.version)).toEqual(['1.3.0-beta.2', '1.2.4-beta.1']);
    });

    it('bumps the major for a bang subject or a BREAKING CHANGE body', () => {
        const bang = makeRepo();
        bang.commit('feat!: drop the old api');
        expect(deriveBuildInfo({ cwd: bang.dir })).toMatchObject({ version: '2.0.0-beta.1', next: '2.0.0' });

        const footer = makeRepo();
        footer.commit('refactor: rework storage', 'BREAKING CHANGE: the storage layout changed');
        expect(deriveBuildInfo({ cwd: footer.dir }).version).toBe('2.0.0-beta.1');
    });

    it('reports the plain release on the tag', () => {
        const { dir, commit } = makeRepo();
        expect(deriveBuildInfo({ cwd: dir })).toMatchObject({ version: '1.2.3', channel: 'release', build: 0, base: '1.2.3', next: '1.2.3', entries: [] });
        commit('fix: later');
        expect(deriveBuildInfo({ cwd: dir, ref: 'v1.2.3' })).toMatchObject({ version: '1.2.3', channel: 'release', build: 0 });
    });

    it('falls back to a dev label when no release tag is reachable', () => {
        const { dir } = makeRepo({ tag: false });
        expect(deriveBuildInfo({ cwd: dir })).toMatchObject({ version: '1.2.3-dev', channel: 'dev', build: 0, base: null, entries: [] });
    });
});

describe('runtime build info resolver', () => {
    const stamp = { version: '1.3.0-beta.7', release: '1.2.3', base: '1.2.3', next: '1.3.0', channel: 'beta', build: 7, commit: 'abcdef12', builtAt: '2026-09-11T00:00:00.000Z', source: 'git', repoUrl: 'https://github.com/o/r', entries: [] };

    it('reads the stamp when there is no .git', () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, 'build-info.json'), JSON.stringify(stamp));
        expect(resolveBuildInfo({ root: dir })).toEqual({ ...stamp, source: 'stamp' });
    });

    it('uses package.json as a release when there is neither .git nor a stamp', () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '9.9.9' }));
        expect(resolveBuildInfo({ root: dir })).toMatchObject({ version: '9.9.9', release: '9.9.9', channel: 'release', build: 0, commit: null, source: 'package', entries: [] });
    });

    it('warns once and falls through when git cannot be read', () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /nowhere');
        fs.writeFileSync(path.join(dir, 'build-info.json'), JSON.stringify(stamp));
        const onWarning = jest.fn();
        expect(resolveBuildInfo({ root: dir, onWarning }).source).toBe('stamp');
        expect(onWarning).toHaveBeenCalledTimes(1);
    });

    it('derives live when .git is present', () => {
        const { dir } = makeRepo();
        expect(resolveBuildInfo({ root: dir })).toMatchObject({ version: '1.2.3', source: 'git' });
    });
});
