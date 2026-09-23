import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest, apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import SkillEditor from '@/views/Ai/SkillEditor.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const CHECK = '/api/v2/agents/skills/egress-check';
const SECRETS = '/api/v2/secrets';
const ACCESS = '/api/v2/instance/access';

const num = (min, max, def) => ({ type: 'number', min, max, default: def });
const LINK_PARAMS = { hosts: { type: 'hosts', max: 4 }, link: { type: 'input', values: ['pr_link', 'public_url', 'linked_doc'] } };
const externalParams = (formats, extra = {}) => ({
    host: { type: 'host', required: true },
    path: { type: 'path', required: true, ...(extra.link ? { unless: 'link' } : {}), maxLength: 2000 },
    method: { type: 'enum', values: ['GET'], default: 'GET' },
    maxBytes: num(1024, 524288, 262144),
    timeoutMs: num(500, 10000, 8000),
    maxRedirects: num(0, 3, 1),
    credential: { type: 'secret_handle', kind: 'skill_read' },
    format: { type: 'enum', values: formats, default: formats[0] },
    ...extra,
});
const TASK_READER = { key: 'task', params: { maxChars: num(200, 20000, 6000) }, fields: ['key', 'title', 'brief', 'chars'] };
const EXTERNAL = [
    { key: 'url', external: true, params: externalParams(['text', 'diff'], LINK_PARAMS), fields: ['status', 'text', 'bytes'] },
    { key: 'api', external: true, params: externalParams(['json', 'text', 'diff']), fields: ['status', 'json', 'text', 'bytes'] },
];
const catalogues = (on) => ({
    inputs: [{ key: 'pr_link', label: 'PR link', description: '' }, { key: 'public_url', label: 'Public URL', description: '' }, { key: 'brief', label: 'Brief', description: '' }],
    readers: on ? [TASK_READER, ...EXTERNAL] : [TASK_READER],
    actions: [{ key: 'task.comment', risk: 'low', required: ['body'] }],
    partials: [],
    risks: ['low', 'medium', 'high'],
    taskFields: ['TaskKey', 'TaskName'],
});

const HANDLE_GH = 'sec_aaaaaaaaaaaaaaaaaaaaaaaa';
const HANDLE_OTHER = 'sec_bbbbbbbbbbbbbbbbbbbbbbbb';
const HANDLE_INTEGRATION = 'sec_cccccccccccccccccccccccc';
const HANDLE_REVOKED = 'sec_dddddddddddddddddddddddd';
const HANDLE_PORT = 'sec_eeeeeeeeeeeeeeeeeeeeeeee';
const SECRET_ROWS = [
    { handle: HANDLE_GH, name: 'GitHub reader', kind: 'skill_read', hosts: ['api.github.com'], header: 'authorization', revokedAt: null },
    { handle: HANDLE_OTHER, name: 'GitLab reader', kind: 'skill_read', hosts: ['gitlab.com'], revokedAt: null },
    { handle: HANDLE_INTEGRATION, name: 'Slack webhook', kind: 'integration', revokedAt: null },
    { handle: HANDLE_REVOKED, name: 'Old GitHub reader', kind: 'skill_read', hosts: ['api.github.com'], revokedAt: '2026-09-01T00:00:00.000Z' },
    { handle: HANDLE_PORT, name: 'GitHub on 8443', kind: 'skill_read', hosts: ['api.github.com:8443'], revokedAt: null },
];

const apiSkill = (params = {}) => ({
    key: 'pr.fetch',
    name: 'PR fetch',
    inputs: ['pr_link'],
    gather: [{ reader: 'api', as: 'pr', params: { host: 'api.github.com', path: '/repos/{{input.pr_link}}', ...params } }],
    prompt: { partials: [], instructions: 'Summarise.', template: '{{gather.pr.text}}', output: '{}' },
    emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }],
});

let hostStates;
let instanceAdmin;
let saveResult;

const serve = () => {
    apiRequest.mockImplementation((method, url, body) => {
        if (method === 'get' && url.startsWith('/api/v2/agents/models')) return Promise.resolve({ data: { status: true, data: { models: [] } } });
        if (method === 'get' && url.startsWith(`${CHECK}?`)) {
            const host = decodeURIComponent(url.split('host=')[1] || '');
            const answer = hostStates[host] || { state: 'not_listed' };
            if (answer.fail) return Promise.reject(Object.assign(new Error('Request failed with status code 503'), { response: { status: 503, data: { status: false } } }));
            return Promise.resolve({ data: { status: true, data: { host, ...answer } } });
        }
        if (method === 'get' && url === SECRETS) return Promise.resolve({ data: { status: true, data: SECRET_ROWS } });
        if ((method === 'post' || method === 'put') && url.startsWith('/api/v2/agents/skills')) return saveResult(body);
        return Promise.reject(new Error(`unexpected ${method} ${url}`));
    });
    apiRequestWithoutCompnay.mockImplementation((method, url) => {
        if (method === 'get' && url === ACCESS) return Promise.resolve({ data: { status: true, data: { allowed: instanceAdmin } } });
        return Promise.reject(new Error(`unexpected ${method} ${url}`));
    });
};

const RouterLink = { name: 'RouterLink', props: ['to'], template: '<a class="router-link" :data-to="JSON.stringify(to)"><slot /></a>' };

let mounted = null;

/* The editor teleports to <body>; a stubbed Teleport would remount its content on every render. */
const open = async ({ on = true, skill = apiSkill() } = {}) => {
    mounted = mount(SkillEditor, {
        props: { skill, catalogues: catalogues(on) },
        global: { mocks: { $t: t }, stubs: { RouterLink } },
    });
    await flushPromises();
    return new DOMWrapper(document.body);
};

const calls = (prefix) => apiRequest.mock.calls.filter(([, url]) => url.startsWith(prefix));

beforeEach(() => {
    hostStates = { 'api.github.com': { state: 'allowed' } };
    instanceAdmin = true;
    saveResult = (body) => Promise.resolve({ data: { status: true, data: body } });
    serve();
});

afterEach(() => {
    if (mounted) mounted.unmount();
    mounted = null;
    vi.useRealTimers();
});

describe('Skill editor: declared reads', () => {
    it('shows nothing new, and asks nothing new, with declared reads off', async () => {
        const wrapper = await open({ on: false });
        expect(wrapper.find('[data-test="declared-read"]').exists()).toBe(false);
        expect(calls(CHECK)).toHaveLength(0);
        expect(calls(SECRETS)).toHaveLength(0);
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
    });

    it('shows nothing new for a workspace reader with declared reads on', async () => {
        const wrapper = await open({ skill: { ...apiSkill(), gather: [{ reader: 'task', as: 'task', params: {} }] } });
        expect(wrapper.find('[data-test="declared-read"]').exists()).toBe(false);
        expect(calls(CHECK)).toHaveLength(0);
    });

    it('shows host, path with placeholder help, format and the caps with their limits for an api reader', async () => {
        const wrapper = await open();
        const section = wrapper.find('[data-test="declared-read"]');
        expect(section.exists()).toBe(true);
        expect(section.find('[data-test="read-host"]').element.value).toBe('api.github.com');
        expect(section.find('[data-test="read-path"]').element.value).toBe('/repos/{{input.pr_link}}');
        const help = section.find('[data-test="read-path-help"]').text();
        expect(help).toContain('{{input.pr_link}}');
        expect(help).toContain('{{task.TaskKey}}');
        expect(help).not.toContain('{{input.brief}}');
        expect(section.findAll('[data-test="read-format"] option').map((o) => o.element.value)).toEqual(['json', 'text', 'diff']);
        const caps = section.findAll('[data-test="read-cap"]');
        expect(caps.map((c) => [c.attributes('min'), c.attributes('max')])).toEqual([['1024', '524288'], ['500', '10000'], ['0', '3']]);
        expect(section.text()).toContain(t('Ai.skill_read_cap_range', { min: 1024, max: 524288 }));
    });

    it('offers the url formats for a url reader', async () => {
        const skill = apiSkill();
        skill.gather[0].reader = 'url';
        const wrapper = await open({ skill });
        expect(wrapper.findAll('[data-test="read-format"] option').map((o) => o.element.value)).toEqual(['text', 'diff']);
    });

    describe('allowlist chip', () => {
        it('says a listed host is allowed, asking with the host alone', async () => {
            const wrapper = await open();
            const chip = wrapper.find('[data-test="read-host-state"]');
            expect(chip.text()).toBe(t('Ai.skill_read_chip_allowed'));
            expect(chip.classes()).toContain('ah-chip--ok');
            expect(calls(CHECK).map(([, url]) => url)).toEqual([`${CHECK}?host=api.github.com`]);
            expect(wrapper.find('.router-link').exists()).toBe(false);
        });

        it('says an unlisted host is not on the list and links an instance owner to the Egress tab', async () => {
            hostStates['api.github.com'] = { state: 'not_listed' };
            const wrapper = await open();
            const chip = wrapper.find('[data-test="read-host-state"]');
            expect(chip.text()).toBe(t('Ai.skill_read_chip_not_listed'));
            expect(chip.classes()).toContain('ah-chip--warn');
            const link = wrapper.find('.router-link');
            expect(link.exists()).toBe(true);
            expect(JSON.parse(link.attributes('data-to'))).toMatchObject({ name: 'InstanceEgress' });
            expect(link.text()).toBe(t('Ai.skill_read_open_egress'));
        });

        it('tells an admin who is not the instance owner who adds the host, without a link', async () => {
            hostStates['api.github.com'] = { state: 'not_listed' };
            instanceAdmin = false;
            const wrapper = await open();
            expect(wrapper.find('.router-link').exists()).toBe(false);
            expect(wrapper.find('[data-test="declared-read"]').text()).toContain(t('Ai.skill_read_ask_owner'));
        });

        it('says a host no skill may declare is not allowed, with the reason', async () => {
            hostStates['127.0.0.1.nip.io'] = { state: 'not_declarable', reason: 'wildcard_dns' };
            const wrapper = await open({ skill: apiSkill({ host: '127.0.0.1.nip.io' }) });
            const chip = wrapper.find('[data-test="read-host-state"]');
            expect(chip.text()).toBe(t('Ai.skill_read_chip_not_declarable'));
            expect(chip.classes()).toContain('ah-chip--danger');
            expect(wrapper.find('[data-test="read-host-reason"]').text()).toBe(t('Ai.skill_read_host_wildcard_dns', { host: '127.0.0.1.nip.io' }));
            expect(wrapper.find('.router-link').exists()).toBe(false);
        });

        it('says when the list could not be checked', async () => {
            hostStates['api.github.com'] = { fail: true };
            const wrapper = await open();
            expect(wrapper.find('[data-test="read-host-state"]').text()).toBe(t('Ai.skill_read_chip_unchecked'));
        });

        it('checks again as the host is typed, once it settles', async () => {
            vi.useFakeTimers();
            hostStates['gitlab.com'] = { state: 'not_listed' };
            const wrapper = await open();
            await wrapper.find('[data-test="read-host"]').setValue('gitlab.com');
            expect(calls(CHECK)).toHaveLength(1);
            vi.advanceTimersByTime(500);
            await flushPromises();
            expect(calls(CHECK).map(([, url]) => url)).toContain(`${CHECK}?host=gitlab.com`);
            expect(wrapper.find('[data-test="read-host-state"]').text()).toBe(t('Ai.skill_read_chip_not_listed'));
        });
    });

    describe('credential picker', () => {
        it('offers only live skill_read secrets that name the declared host and port, by name and handle', async () => {
            const wrapper = await open();
            const options = wrapper.findAll('[data-test="read-credential"] option');
            expect(options.map((o) => o.element.value)).toEqual(['', HANDLE_GH]);
            expect(options[1].text()).toContain('GitHub reader');
        });

        it('filters again when the host changes', async () => {
            const wrapper = await open();
            await wrapper.find('[data-test="read-host"]').setValue('api.github.com:8443');
            await flushPromises();
            expect(wrapper.findAll('[data-test="read-credential"] option').map((o) => o.element.value)).toEqual(['', HANDLE_PORT]);
            await wrapper.find('[data-test="read-host"]').setValue('example.net');
            await flushPromises();
            expect(wrapper.findAll('[data-test="read-credential"] option').map((o) => o.element.value)).toEqual(['']);
            expect(wrapper.find('[data-test="declared-read"]').text()).toContain(t('Ai.skill_read_credential_empty', { host: 'example.net' }));
        });

        it('is a handle picker: no field takes a secret value', async () => {
            const wrapper = await open();
            const section = wrapper.find('[data-test="declared-read"]');
            expect(section.find('[data-test="read-credential"]').element.tagName).toBe('SELECT');
            expect(section.find('input[type="password"]').exists()).toBe(false);
            expect(section.findAll('input, textarea').map((el) => el.attributes('data-test'))).not.toContain('read-credential');
        });

        it('keeps a chosen handle and saves it', async () => {
            const wrapper = await open({ skill: apiSkill({ credential: HANDLE_GH }) });
            expect(wrapper.find('[data-test="read-credential"]').element.value).toBe(HANDLE_GH);
            await wrapper.find('.ah-btn--primary').trigger('click');
            await flushPromises();
            const [, , body] = apiRequest.mock.calls.find(([m, url]) => m === 'put' && url.startsWith('/api/v2/agents/skills'));
            expect(body.gather[0].params).toMatchObject({ host: 'api.github.com', credential: HANDLE_GH });
        });
    });

    it('saves the caps as numbers and leaves blank ones out', async () => {
        const wrapper = await open();
        const caps = wrapper.findAll('[data-test="read-cap"]');
        await caps[0].setValue('4096');
        await caps[1].setValue('3000');
        await caps[1].setValue('');
        await wrapper.find('[data-test="read-credential"]').setValue(HANDLE_GH);
        await wrapper.find('[data-test="read-credential"]').setValue('');
        await wrapper.find('[data-test="read-format"]').setValue('text');
        await wrapper.find('.ah-btn--primary').trigger('click');
        await flushPromises();
        const [, , body] = apiRequest.mock.calls.find(([m, url]) => m === 'put' && url.startsWith('/api/v2/agents/skills'));
        expect(body.gather[0].params).toEqual({ host: 'api.github.com', path: '/repos/{{input.pr_link}}', maxBytes: 4096, format: 'text' });
    });

    it('shows each save error next to the field it concerns, in the reader\'s language', async () => {
        const errors = [
            { field: 'gather[0].params.host', code: 'host_not_allowed', host: 'api.github.com', message: 'server words 1' },
            { field: 'gather[0].params.credential', code: 'credential_host_not_bound', message: 'server words 2' },
            { field: 'gather[0].params.maxBytes', code: 'invalid_params', message: 'server words 3' },
            { field: 'gather[0].params.path', code: 'invalid_path', message: 'server words 4' },
            { field: 'gather', code: 'allowlist_unreadable', message: 'server words 5' },
            { field: 'prompt.instructions', code: 'secret_in_body', message: 'server words 6' },
        ];
        saveResult = () => Promise.reject(Object.assign(new Error('Request failed with status code 400'), {
            response: { status: 400, data: { status: false, statusText: 'The skill has errors.', data: { errors } } },
        }));
        const wrapper = await open();
        await wrapper.find('.ah-btn--primary').trigger('click');
        await flushPromises();

        const at = (test) => wrapper.find(`[data-test="${test}"]`).text();
        expect(at('read-host-error')).toBe(t('Ai.skill_read_err_host_not_allowed', { host: 'api.github.com' }));
        expect(at('read-credential-error')).toBe(t('Ai.skill_read_err_credential_host_not_bound'));
        expect(at('read-cap-error-maxBytes')).toBe(t('Ai.skill_read_err_range', { min: 1024, max: 524288 }));
        expect(at('read-path-error')).toBe(t('Ai.skill_read_err_invalid_path'));
        expect(at('gather-error')).toBe(t('Ai.skill_read_err_allowlist_unreadable'));
        expect(at('instructions-error')).toBe(t('Ai.skill_read_err_secret_in_body'));
        expect(wrapper.text()).not.toMatch(/server words/);
    });

    it('translates a host refused for its shape by the reason', async () => {
        saveResult = () => Promise.reject(Object.assign(new Error('x'), {
            response: { status: 400, data: { status: false, statusText: 'The skill has errors.', data: { errors: [{ field: 'gather[0].params.host', code: 'host_not_allowed', host: 'build.corp', reason: 'private', message: 'server words' }] } } },
        }));
        const wrapper = await open({ skill: apiSkill({ host: 'build.corp' }) });
        await wrapper.find('.ah-btn--primary').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="read-host-error"]').text()).toBe(t('Ai.skill_read_host_private', { host: 'build.corp' }));
    });

    it('has a line in the locale for every code, state and reason it can show', async () => {
        const { READ_ERROR_CODES, HOST_STATES, HOST_REASONS } = await import('@/views/Ai/declaredReads');
        const ai = en.Ai;
        READ_ERROR_CODES.forEach((code) => expect(ai[`skill_read_err_${code}`]).toBeTruthy());
        HOST_STATES.forEach((state) => expect(ai[`skill_read_chip_${state}`]).toBeTruthy());
        HOST_REASONS.forEach((reason) => expect(ai[`skill_read_host_${reason}`]).toBeTruthy());
    });
});

const PR_SUMMARY_HOSTS = ['patch-diff.githubusercontent.com', 'gitlab.com'];
const linkSkill = (params = {}, inputs = ['pr_link']) => ({
    key: 'pr.summary',
    name: 'Reviewer',
    inputs,
    gather: [{ reader: 'url', as: 'pr', params: { host: 'github.com', hosts: [...PR_SUMMARY_HOSTS], link: 'pr_link', format: 'diff', maxRedirects: 2, ...params } }],
    prompt: { partials: [], instructions: 'Review.', template: '{{gather.pr.text}}', output: '{}' },
    emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }],
});
const pathSkill = (params = {}, inputs) => {
    const skill = linkSkill({ path: '/repos/{{input.pr_link}}', ...params }, inputs);
    delete skill.gather[0].params.link;
    return skill;
};

const saved = () => apiRequest.mock.calls.find(([m, url]) => m === 'put' && url.startsWith('/api/v2/agents/skills'))[2];
const clickSave = async (wrapper) => {
    await wrapper.find('.ah-btn--primary').trigger('click');
    await flushPromises();
};
const refuse = (errors) => () => Promise.reject(Object.assign(new Error('x'), {
    response: { status: 400, data: { status: false, statusText: 'The skill has errors.', data: { errors } } },
}));

describe('Skill editor: link and extra hosts of a declared read', () => {
    beforeEach(() => {
        hostStates['github.com'] = { state: 'allowed' };
        hostStates['patch-diff.githubusercontent.com'] = { state: 'allowed' };
        hostStates['gitlab.com'] = { state: 'not_listed' };
    });

    it('offers neither to an api reader, whose catalogue takes no link or hosts', async () => {
        const wrapper = await open();
        expect(wrapper.find('[data-test="read-link"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="read-hosts"]').exists()).toBe(false);
    });

    it('reloads a saved link and extra hosts, with the path hidden while a link is read', async () => {
        const wrapper = await open({ skill: linkSkill() });
        expect(wrapper.find('[data-test="read-link"]').element.value).toBe('pr_link');
        expect(wrapper.find('[data-test="read-path"]').exists()).toBe(false);
        expect(wrapper.findAll('[data-test="read-extra-host"]').map((i) => i.element.value)).toEqual(PR_SUMMARY_HOSTS);
    });

    it('checks each extra host against the allowlist like the main host', async () => {
        const wrapper = await open({ skill: linkSkill() });
        const asked = calls(CHECK).map(([, url]) => decodeURIComponent(url.split('host=')[1]));
        expect(asked).toEqual(expect.arrayContaining(['github.com', ...PR_SUMMARY_HOSTS]));
        const chips = wrapper.findAll('[data-test="read-extra-host-state"]');
        expect(chips.map((c) => c.text())).toEqual([t('Ai.skill_read_chip_allowed'), t('Ai.skill_read_chip_not_listed')]);
    });

    it('offers only the link inputs the skill declares', async () => {
        const wrapper = await open({ skill: linkSkill({}, ['pr_link', 'brief']) });
        expect(wrapper.findAll('[data-test="read-link"] option').map((o) => o.element.value)).toEqual(['', 'pr_link']);
    });

    it('says which inputs to declare when no link input is declared', async () => {
        const wrapper = await open({ skill: pathSkill({}, ['brief']) });
        expect(wrapper.findAll('[data-test="read-link"] option').map((o) => o.element.value)).toEqual(['']);
        expect(wrapper.find('[data-test="read-link-hint"]').text()).toBe(t('Ai.skill_read_link_none_declared', { inputs: 'pr_link, public_url, linked_doc' }));
    });

    it('saves the link and extra hosts as they were loaded', async () => {
        const wrapper = await open({ skill: linkSkill() });
        await clickSave(wrapper);
        expect(saved().gather[0].params).toEqual({ host: 'github.com', hosts: PR_SUMMARY_HOSTS, link: 'pr_link', format: 'diff', maxRedirects: 2 });
    });

    it('saves a link in place of the path, and the path again once the link is cleared', async () => {
        const wrapper = await open({ skill: pathSkill({ hosts: [] }) });
        expect(wrapper.find('[data-test="read-path"]').exists()).toBe(true);
        await wrapper.find('[data-test="read-link"]').setValue('pr_link');
        expect(wrapper.find('[data-test="read-path"]').exists()).toBe(false);
        await clickSave(wrapper);
        expect(saved().gather[0].params).toEqual({ host: 'github.com', link: 'pr_link', format: 'diff', maxRedirects: 2 });

        apiRequest.mockClear();
        await wrapper.find('[data-test="read-link"]').setValue('');
        expect(wrapper.find('[data-test="read-path"]').element.value).toBe('/repos/{{input.pr_link}}');
        await clickSave(wrapper);
        expect(saved().gather[0].params).toEqual({ host: 'github.com', path: '/repos/{{input.pr_link}}', format: 'diff', maxRedirects: 2 });
    });

    it('adds and removes extra hosts up to the catalogue limit, leaving blank rows out of the save', async () => {
        const wrapper = await open({ skill: linkSkill() });
        const add = () => wrapper.find('[data-test="read-add-host"]');
        await add().trigger('click');
        await wrapper.findAll('[data-test="read-extra-host"]')[2].setValue('api.github.com');
        await add().trigger('click');
        expect(wrapper.findAll('[data-test="read-extra-host"]')).toHaveLength(4);
        expect(add().attributes('disabled')).toBeDefined();
        await wrapper.findAll('[data-test="read-extra-host-remove"]')[1].trigger('click');
        expect(wrapper.findAll('[data-test="read-extra-host"]').map((i) => i.element.value)).toEqual(['patch-diff.githubusercontent.com', 'api.github.com', '']);
        expect(add().attributes('disabled')).toBeUndefined();
        await clickSave(wrapper);
        expect(saved().gather[0].params.hosts).toEqual(['patch-diff.githubusercontent.com', 'api.github.com']);
    });

    it('leaves the hosts list out of the save once every extra host is removed', async () => {
        const wrapper = await open({ skill: linkSkill({ hosts: ['gitlab.com'] }) });
        await wrapper.find('[data-test="read-extra-host-remove"]').trigger('click');
        await clickSave(wrapper);
        expect(saved().gather[0].params).not.toHaveProperty('hosts');
    });

    it('shows the save refusals next to the link and each extra host, in the reader\'s language', async () => {
        saveResult = refuse([
            { field: 'gather[0].params.hosts[0]', code: 'host_not_allowed', host: '*.githubusercontent.com', reason: 'wildcard', message: 'server words 1' },
            { field: 'gather[0].params.hosts[1]', code: 'host_not_allowed', host: 'gitlab.com', message: 'server words 2' },
            { field: 'gather[0].params.link', code: 'undeclared_input', message: 'server words 3' },
            { field: 'gather[0].params.hosts', code: 'invalid_params', message: 'server words 4' },
        ]);
        const wrapper = await open({ skill: linkSkill() });
        await clickSave(wrapper);
        expect(wrapper.findAll('[data-test="read-extra-host-error"]').map((e) => e.text())).toEqual([
            t('Ai.skill_read_host_wildcard', { host: '*.githubusercontent.com' }),
            t('Ai.skill_read_err_host_not_allowed', { host: 'gitlab.com' }),
        ]);
        expect(wrapper.find('[data-test="read-link-error"]').text()).toBe(t('Ai.skill_read_err_link_undeclared', { input: 'pr_link' }));
        expect(wrapper.find('[data-test="read-hosts-error"]').text()).toBe(t('Ai.skill_read_err_hosts_max', { max: 4 }));
        expect(wrapper.text()).not.toMatch(/server words/);
    });

    it('translates a link input the reader does not take', async () => {
        saveResult = refuse([{ field: 'gather[0].params.link', code: 'invalid_params', message: 'server words' }]);
        const wrapper = await open({ skill: linkSkill() });
        await clickSave(wrapper);
        expect(wrapper.find('[data-test="read-link-error"]').text()).toBe(t('Ai.skill_read_err_link_invalid'));
    });

    it('says a path or a link is needed when a url read has neither', async () => {
        saveResult = refuse([{ field: 'gather[0].params.path', code: 'required', message: 'required' }]);
        const wrapper = await open({ skill: pathSkill({ path: '' }) });
        await clickSave(wrapper);
        expect(wrapper.find('[data-test="read-path-error"]').text()).toBe(t('Ai.skill_read_err_path_or_link'));
    });
});
