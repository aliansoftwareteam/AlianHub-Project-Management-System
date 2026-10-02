const fs = require('fs');
const path = require('path');

const WORKFLOW = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8');

const jobs = Object.fromEntries(
    WORKFLOW.slice(WORKFLOW.indexOf('\njobs:\n'))
        .split(/^ {2}(?=[\w-]+:\n)/m)
        .slice(1)
        .map((block) => [block.slice(0, block.indexOf(':')), block])
);
const count = (text, needle) => text.split(needle).length - 1;
const jobsRunning = (command) => Object.entries(jobs).filter(([, block]) => block.includes(command));
const shardJobs = () => jobsRunning('npm run e2e -- --shard=');

describe('the browser tests in CI', () => {
    test('run in shards that share no database and no server', () => {
        expect(shardJobs()).toHaveLength(1);
        const [id, block] = shardJobs()[0];
        expect(id).not.toBe('e2e');
        expect(block).toMatch(/^ {4}name: e2e shard \(/m);
        expect(block).toContain('fail-fast: false');
        expect(block).toContain('npm run e2e -- --shard=${{ matrix.shard }}/${{ strategy.job-total }}');
        expect(block).toContain('image: mongo:7');
    });

    test('keep one failure report per shard', () => {
        const [, block] = shardJobs()[0];
        expect(block).toContain('name: e2e-report-shard-${{ matrix.shard }}');
        expect(block).toContain('e2e/test-results');
    });

    test('build the frontend once and run each API test once', () => {
        expect(jobsRunning('npm run test:integration')).toHaveLength(1);
        const [, integration] = jobsRunning('npm run test:integration')[0];
        expect(count(WORKFLOW, 'npm run test:integration')).toBe(1);
        expect(integration).toContain('npm run test:integration -- --shard=${{ matrix.shard }}/${{ strategy.job-total }}');
        expect(integration).toContain('name: integration-logs-shard-${{ matrix.shard }}');
        [integration, shardJobs()[0][1]].forEach((block) => {
            expect(block).not.toContain('npm run build');
            expect(block).toContain('actions/download-artifact@v4');
            expect(block).toContain('image: mongo:7');
        });
    });

    // Tooling and branch rules look for a check called "e2e"; a job with a `name:` reports under that name instead.
    test('report through one check named e2e that fails unless every part passed', () => {
        const [shardId] = shardJobs()[0];
        const [integrationId] = jobsRunning('npm run test:integration')[0];
        const summary = jobs.e2e;
        expect(summary).not.toMatch(/^ {4}name:/m);
        expect(summary).not.toContain('npm run e2e');
        const needs = /^ {4}needs: \[(.+)\]$/m.exec(summary)[1].split(', ');
        expect(needs).toEqual(expect.arrayContaining(['changes', shardId, integrationId]));
        expect(summary).toMatch(/^ {4}if: always\(\) && needs\.changes\.outputs\.code == 'true'/m);
        needs.filter((id) => id !== 'changes').forEach((id) => {
            expect(summary).toContain(`needs.${id}.result`);
        });
    });
});
