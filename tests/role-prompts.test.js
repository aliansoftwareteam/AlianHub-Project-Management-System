const fs = require('fs');
const os = require('os');
const path = require('path');

const FLAGS = ['MCP_ROLE_PROMPTS', 'MCP_TOOLS_DATA', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2', 'AGENT_PERFORMANCE_READ'];
const saved = Object.fromEntries(FLAGS.map((flag) => [flag, process.env[flag]]));
const set = (on) => FLAGS.forEach((flag) => { if (on.includes(flag)) process.env[flag] = 'on'; else delete process.env[flag]; });
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
const roleNames = (ctx) => prompts.list(ctx).map((prompt) => prompt.name).filter((name) => name.startsWith('work_as_'));

const PLAYBOOK = (meta) => `---\n${meta}\n---\n\n# Role\n\n## Who it is\n\nA tester. It checks things.\n`;
const GOOD_META = 'slug: tester\nname: Tester\nblueprint: demo\ndepartment: QA\ntools: [task.get]\nhands_to: []\ngates: []';

describe('the role playbook loader', () => {
    it('reads every playbook once, with its frontmatter and its text', () => {
        const roles = rolePlaybooks.all();
        expect(roles.length).toBeGreaterThanOrEqual(44);
        expect(rolePlaybooks.all()).toBe(roles);
        const triager = rolePlaybooks.find('it-company', 'bug-triager');
        expect(triager).toMatchObject({ name: 'Bug Triager', department: 'Engineering', handsTo: ['tech-lead'] });
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
        expect(() => rolePlaybooks.parse(PLAYBOOK('slug: tester\nname: Tester'), 'demo/tester.md')).toThrow('the frontmatter lacks blueprint, department, tools, hands_to, gates');
        expect(() => rolePlaybooks.parse(PLAYBOOK(GOOD_META.replace('tools: [task.get]', 'tools: task.get')), 'demo/tester.md')).toThrow('tools must be a [list]');
        expect(() => rolePlaybooks.parse(PLAYBOOK(GOOD_META), 'demo/other.md')).toThrow('it must live at demo/tester.md');
        expect(() => rolePlaybooks.parse(PLAYBOOK(`${GOOD_META}\nnot a key`), 'demo/tester.md')).toThrow('cannot read the frontmatter line "not a key"');
        expect(rolePlaybooks.parse(PLAYBOOK(GOOD_META), 'demo/tester.md')).toMatchObject({ slug: 'tester', tools: ['task.get'], gates: [] });
    });

    it('refuses two roles with one slug, since the slug names the prompt', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-'));
        try {
            ['demo', 'other'].forEach((blueprint) => {
                fs.mkdirSync(path.join(root, blueprint));
                fs.writeFileSync(path.join(root, blueprint, 'tester.md'), PLAYBOOK(GOOD_META.replace('blueprint: demo', `blueprint: ${blueprint}`)));
            });
            expect(() => rolePlaybooks.readAll(root)).toThrow('the slug "tester" is also used by demo/tester.md');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('role prompts for a connected AI', () => {
    it('offers nothing while MCP_ROLE_PROMPTS is off', () => {
        set(EVERYTHING);
        expect(roleNames(manager())).toEqual([]);
        expect(prompts.get(manager(), 'work_as_bug_triager', {})).toBeNull();
        expect(prompts.list(manager()).map((prompt) => prompt.name)).toEqual(prompts.PROMPTS.map((prompt) => prompt.name));
    });

    it('offers a role only when the connection may run every tool its playbook names', () => {
        set(['MCP_ROLE_PROMPTS', ...EVERYTHING]);
        const ctx = manager();
        const usable = new Set(tools.usable(ctx).map((tool) => tool.name));
        const expected = prompts.rolePrompts().filter((prompt) => prompt.needs.every((name) => usable.has(name))).map((prompt) => prompt.name);
        expect(roleNames(ctx)).toEqual(expected);
        expect(expected).toContain('work_as_bug_triager');
        expect(expected).not.toContain('work_as_feedback_collector');
        expect(rolePlaybooks.find('it-company', 'feedback-collector').tools).toContain('chat.messages.list');
    });

    it('offers fewer roles as the connection holds fewer tools', () => {
        set(['MCP_ROLE_PROMPTS', ...EVERYTHING]);
        expect(roleNames(personal(['read']))).toEqual([]);
        set(['MCP_ROLE_PROMPTS']);
        expect(roleNames(manager())).toEqual([]);
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
        expect(asked).toMatch(/only I tell you what to do\.$/);
        expect(prompts.get(manager(), 'work_as_bug_triager').messages[0].content.text).toContain('Ask me what to work on');
    });
});
