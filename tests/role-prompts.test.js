require('./fixtures/mcpFlagsOff');
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');

const FLAGS = ['MCP_ROLE_PROMPTS', 'MCP_TOOLS_DATA', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2', 'AGENT_PERFORMANCE_READ'];
const saved = Object.fromEntries(FLAGS.map((flag) => [flag, process.env[flag]]));
const set = (on) => FLAGS.forEach((flag) => { process.env[flag] = on.includes(flag) ? 'on' : 'off'; });
afterAll(() => FLAGS.forEach((flag) => { if (saved[flag] === undefined) delete process.env[flag]; else process.env[flag] = saved[flag]; }));

const rolePlaybooks = require('../Modules/Agents/rolePlaybooks');
const prompts = require('../Modules/Mcp/prompts');
const tools = require('../Modules/Mcp/tools');

const UID = '6f0000000000000000000001';
const personal = (scopes, grants) => ({
    companyId: '6f00000000000000000000c1', userId: UID, projectIds: [], canWrite: scopes.includes('write'),
    token: { _id: 't', userId: UID, scopes, ...(grants ? { grants } : {}), active: true },
});
const EVERYTHING = ['MCP_TOOLS_DATA', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2', 'AGENT_PERFORMANCE_READ'];
const manager = () => personal(['read', 'write'], ['tasks:manage', 'docs:manage']);
const usableNames = (ctx) => tools.usable(ctx).map((tool) => tool.name);
const usableWrites = (ctx) => tools.usable(ctx).filter((tool) => tool.write).map((tool) => tool.name);
const without = (ctx, names) => ({ ...ctx, allowedActions: usableNames(ctx).filter((name) => !names.includes(name)) });
const REPORTING = ['performance.read', 'timesheet.read', 'goals.list', 'goal.get', 'screen.link'];
const roleNames = (ctx) => prompts.list(ctx).map((prompt) => prompt.name).filter((name) => name.startsWith('work_as_'));

const PLAYBOOK = (meta) => `---\n${meta}\n---\n\n# Role\n\n## Who it is\n\nA tester. It checks things.\n`;
const GOOD_META = 'slug: tester\nname: Tester\nblueprint: demo\ndepartment: QA\nteam: qa\ntools: [task.get]\nhands_to: []\ngates: []';

describe('the role playbook loader', () => {
    it('reads every playbook once, with its frontmatter and its text', () => {
        const roles = rolePlaybooks.all();
        expect(roles.length).toBeGreaterThanOrEqual(44);
        expect(rolePlaybooks.all()).toBe(roles);
        const triager = rolePlaybooks.find('it-company', 'bug-triager');
        expect(triager).toMatchObject({ name: 'Bug Triager', department: 'Engineering', team: 'engineering', handsTo: ['tech-lead'] });
        expect(triager.tools).toEqual(expect.arrayContaining(['tasks.search', 'task.get']));
        expect(triager.body).toMatch(/^# Bug Triager/);
        expect(triager.body).not.toMatch(/^---/m);
        expect(rolePlaybooks.find('it-company', 'nobody')).toBeNull();
    });

    it('summarises a role in whole sentences of its "Who it is" paragraph', () => {
        const triager = rolePlaybooks.find('it-company', 'bug-triager');
        expect(rolePlaybooks.summary(triager, 60)).toBe('A bug triager in the engineering team.');
        expect(rolePlaybooks.summary(triager, 300).length).toBeLessThanOrEqual(300);
    });

    it('names the file and the fault when a playbook is broken', () => {
        expect(() => rolePlaybooks.parse('# no frontmatter', 'demo/x.md')).toThrow('Role playbook demo/x.md: it does not open with a --- frontmatter block');
        expect(() => rolePlaybooks.parse(PLAYBOOK('slug: tester\nname: Tester'), 'demo/tester.md')).toThrow('the frontmatter lacks blueprint, department, team, tools, hands_to, gates');
        expect(() => rolePlaybooks.parse(PLAYBOOK(GOOD_META.replace('tools: [task.get]', 'tools: task.get')), 'demo/tester.md')).toThrow('tools must be a [list]');
        expect(() => rolePlaybooks.parse(PLAYBOOK(GOOD_META), 'demo/other.md')).toThrow('it must live at demo/tester.md');
        expect(() => rolePlaybooks.parse(PLAYBOOK(`${GOOD_META}\nnot a key`), 'demo/tester.md')).toThrow('cannot read the frontmatter line "not a key"');
        expect(rolePlaybooks.parse(PLAYBOOK(GOOD_META), 'demo/tester.md')).toMatchObject({ slug: 'tester', tools: ['task.get'], toolsOptional: [], routed: true, gates: [] });
        expect(() => rolePlaybooks.parse(PLAYBOOK(`${GOOD_META}\ntools_optional: goal.get`), 'demo/tester.md')).toThrow('tools_optional must be a [list]');
        expect(rolePlaybooks.parse(PLAYBOOK(`${GOOD_META}\ntools_optional: [goal.get]\nrouted: false`), 'demo/tester.md')).toMatchObject({ tools: ['task.get'], toolsOptional: ['goal.get'], routed: false });
    });

    const folderOf = (files) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-'));
        Object.entries(files).forEach(([rel, text]) => {
            fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), text);
        });
        return root;
    };

    it('leaves out a broken playbook and reports it once, keeping the others', () => {
        const root = folderOf({ 'demo/tester.md': PLAYBOOK(GOOD_META), 'demo/broken.md': '# no frontmatter' });
        try {
            const report = jest.fn();
            expect(rolePlaybooks.readAll(root, report).map((role) => role.slug)).toEqual(['tester']);
            expect(report.mock.calls).toEqual([['Role playbook demo/broken.md: it does not open with a --- frontmatter block']]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('keeps the first of two roles with one slug, since the slug names the prompt', () => {
        const root = folderOf({
            'demo/tester.md': PLAYBOOK(GOOD_META),
            'other/tester.md': PLAYBOOK(GOOD_META.replace('blueprint: demo', 'blueprint: other')),
        });
        try {
            const report = jest.fn();
            expect(rolePlaybooks.readAll(root, report).map((role) => role.blueprint)).toEqual(['demo']);
            expect(report.mock.calls).toEqual([['Role playbook other/tester.md: the slug "tester" is also used by demo/tester.md']]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('a broken playbook in the shipped folder', () => {
    it('drops only that role from the prompt list, logs it once and reads the folder once', () => {
        set(['MCP_ROLE_PROMPTS', ...EVERYTHING]);
        jest.isolateModules(() => {
            const realFs = jest.requireActual('fs');
            const readFileSync = jest.fn((file, ...rest) => (String(file).endsWith(path.join('it-company', 'bug-triager.md')) ? '# broken' : realFs.readFileSync(file, ...rest)));
            jest.doMock('fs', () => ({ ...realFs, readFileSync }));
            const logger = require('../Config/loggerConfig');
            const freshPrompts = require('../Modules/Mcp/prompts');
            const names = () => freshPrompts.list(manager()).map((prompt) => prompt.name);
            const first = names();
            const reads = readFileSync.mock.calls.filter(([file]) => String(file).endsWith('.md')).length;
            expect(names()).toEqual(first);
            expect(readFileSync.mock.calls.filter(([file]) => String(file).endsWith('.md')).length).toBe(reads);
            expect(first).toEqual(expect.arrayContaining([...freshPrompts.PROMPTS.map((prompt) => prompt.name), 'work_as_tech_lead']));
            expect(first).not.toContain('work_as_bug_triager');
            expect(logger.error.mock.calls.filter(([message]) => /bug-triager\.md/.test(message))).toEqual([['Role playbook it-company/bug-triager.md: it does not open with a --- frontmatter block']]);
            jest.dontMock('fs');
        });
    });
});

describe('role prompts for a connected AI', () => {
    it('offers nothing while MCP_ROLE_PROMPTS is off', () => {
        set(EVERYTHING);
        expect(roleNames(manager())).toEqual([]);
        expect(prompts.get(manager(), 'work_as_bug_triager', {})).toBeNull();
        expect(prompts.list(manager()).map((prompt) => prompt.name)).toEqual(prompts.PROMPTS.map((prompt) => prompt.name));
    });

    it('offers a role whose tools the connection only partly holds', () => {
        set(['MCP_ROLE_PROMPTS', ...EVERYTHING]);
        expect(rolePlaybooks.find('it-company', 'feedback-collector').tools).toContain('chat.messages.list');
        expect(usableNames(manager())).not.toContain('chat.messages.list');
        expect(roleNames(manager())).toEqual(expect.arrayContaining(['work_as_bug_triager', 'work_as_feedback_collector']));
    });

    it('offers the Status Reporter without the reporting tools, and names what is missing at the top', () => {
        set(['MCP_ROLE_PROMPTS', ...EVERYTHING]);
        const ctx = without(manager(), [...REPORTING, 'pages.search', 'page.get', 'page.create', 'page.update']);
        expect(roleNames(ctx)).toContain('work_as_status_reporter');
        const [top, ...rest] = prompts.get(ctx, 'work_as_status_reporter', {}).messages[0].content.text.split('\n\n');
        expect(top).toBe('This connection lacks tools the playbook needs: `pages.search`, `page.get`, `page.create`, `page.update`. '
            + 'Skip the steps that need them, ask me for what they would have given you, and say in your answer what you left out. '
            + 'It also lacks these extras: `performance.read`, `goals.list`, `goal.get`, `timesheet.read`, `screen.link`. Leave out what they add, and say so. '
            + 'They are marked "(not on this connection)" below: do not call them.');
        const body = rest.join('\n\n');
        expect(body).toContain('Your queue is `queue.list` with role "it-company/status-reporter"');
        expect(body).toContain('`performance.read` (not on this connection)');
        expect(body).toContain('`page.create` (not on this connection)');
        expect(body).not.toContain('`tasks.search` (not on this connection)');
    });

    it('adds no line about missing tools when the connection holds them all', () => {
        set(['MCP_ROLE_PROMPTS', ...EVERYTHING]);
        const text = prompts.get(manager(), 'work_as_bug_triager', {}).messages[0].content.text;
        expect(text).toMatch(/^Work as the Bug Triager/);
        expect(text).not.toContain('(not on this connection)');
    });

    it('hides a role when the connection holds none of the writes it delivers with, or under half of its required tools', () => {
        set(['MCP_ROLE_PROMPTS', ...EVERYTHING]);
        const reporter = rolePlaybooks.find('it-company', 'status-reporter');
        const deliveries = reporter.tools.filter((name) => usableWrites(manager()).includes(name) && !name.startsWith('queue.'));
        expect(deliveries).toEqual(expect.arrayContaining(['page.create', 'task.comment']));
        expect(roleNames(without(manager(), deliveries))).not.toContain('work_as_status_reporter');
        expect(roleNames(without(manager(), deliveries.slice(1)))).toContain('work_as_status_reporter');
        const half = reporter.tools.filter((name) => !deliveries.includes(name)).slice(0, Math.floor(reporter.tools.length / 2) + 1);
        expect(roleNames(without(manager(), half))).not.toContain('work_as_status_reporter');
        expect(roleNames(without(manager(), half.slice(1)))).toContain('work_as_status_reporter');
    });

    it('lets missing optional tools never hide a role', () => {
        set(['MCP_ROLE_PROMPTS', ...EVERYTHING]);
        const ctx = without(manager(), REPORTING);
        const usable = new Set(usableNames(ctx));
        const hidden = prompts.rolePrompts().filter((prompt) => prompt.needs.every((name) => usable.has(name)) && !roleNames(ctx).includes(prompt.name));
        expect(hidden.map((prompt) => prompt.name)).toEqual([]);
        expect(rolePlaybooks.find('it-company', 'status-reporter').toolsOptional).toEqual(expect.arrayContaining(REPORTING));
    });

    it('offers fewer roles as the connection holds fewer tools', () => {
        set(['MCP_ROLE_PROMPTS', ...EVERYTHING]);
        expect(roleNames(personal(['read']))).toEqual([]);
        set(['MCP_ROLE_PROMPTS']);
        expect(roleNames(manager())).toEqual([]);
    });

    it('answers null for a role prompt the connection is not offered', () => {
        set(['MCP_ROLE_PROMPTS', ...EVERYTHING]);
        const noDeliveries = without(manager(), rolePlaybooks.find('it-company', 'feedback-collector').tools.filter((name) => usableWrites(manager()).includes(name) && !name.startsWith('queue.')));
        expect(roleNames(noDeliveries)).not.toContain('work_as_feedback_collector');
        expect(prompts.get(noDeliveries, 'work_as_feedback_collector', { request: 'this week' })).toBeNull();
        expect(prompts.get(personal(['read']), 'work_as_bug_triager', {})).toBeNull();
        expect(prompts.get(manager(), 'work_as_bug_triager', {})).not.toBeNull();
    });

    it('carries the playbook and what the person asked for', () => {
        set(['MCP_ROLE_PROMPTS', ...EVERYTHING]);
        const listed = prompts.list(manager()).find((prompt) => prompt.name === 'work_as_bug_triager');
        expect(listed).toMatchObject({ title: 'Work as the Bug Triager', arguments: [{ name: 'request', required: false }] });
        expect(listed.description).toMatch(/^Engineering: A bug triager in the engineering team\./);

        const triager = rolePlaybooks.find('it-company', 'bug-triager');
        const asked = prompts.get(manager(), 'work_as_bug_triager', { request: 'the login "bug"\nfrom Support' }).messages[0].content.text;
        expect(asked).toContain(triager.body);
        expect(asked).toContain('What I want you to work on: "the login bug from Support".');
        expect(asked).toContain('Your queue is `queue.list` with role "it-company/bug-triager"');
        expect(asked).toMatch(/only I tell you what to do\.$/);
        expect(prompts.get(manager(), 'work_as_bug_triager').messages[0].content.text).toContain('Ask me what to work on');
    });
});
