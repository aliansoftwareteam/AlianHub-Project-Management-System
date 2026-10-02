/* Task 047, T-5: how many agents work in a project at once, how many tasks an agent changes on its own, and "Pause all", on the project's detail screen. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import fs from 'node:fs';
import path from 'node:path';

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: (key) => key }) }));

import ProjectAgentLimitsCard from '@/views/Projects/ProjectDetail/ProjectAgentLimitsCard.vue';
import en from '@/locales/en';

const URL = '/api/v2/agents/project-limits/p1';
const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../src/views/Projects/ProjectDetail/ProjectAgentLimitsCard.vue'), 'utf8');
const DETAIL = fs.readFileSync(path.resolve(__dirname, '../../src/views/Projects/ProjectDetail/ProjectDetail.vue'), 'utf8');
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (statusText) => Promise.reject(Object.assign(new Error('Request failed'), { response: { status: 403, data: { status: false, statusText } } }));
const answer = (over = {}) => ({
    limits: { atOnce: 3, paused: false, directTasks: 10 },
    defaults: { atOnce: 3, paused: false, directTasks: 10 },
    atOnceRange: { min: 1, max: 20 },
    directTasksRange: { min: 1, max: 100 },
    directTasksMinutes: 10,
    canEdit: true,
    ...over,
});

const mountCard = async (data = answer(), onPut = null) => {
    const held = { ...data.limits };
    const store = (type, url, body) => ok(answer({ limits: Object.assign(held, body) }));
    apiRequest.mockImplementation((type, url, body) => (type === 'get' ? ok(data) : (onPut || store)(type, url, body)));
    const wrapper = mount(ProjectAgentLimitsCard, { props: { projectId: 'p1' }, global: { mocks: { $t: (key) => key } } });
    await flushPromises();
    return wrapper;
};
const select = (wrapper) => wrapper.find('[data-test="at-once"]');
const directTasks = (wrapper) => wrapper.find('[data-test="direct-tasks"]');
const pauseButton = (wrapper) => wrapper.find('[data-test="pause"]');
const resumeButton = (wrapper) => wrapper.find('[data-test="resume"]');

describe('ProjectAgentLimitsCard', () => {
    beforeEach(() => { apiRequest.mockReset(); toast.success.mockReset(); });

    it('shows the limit the project holds, with every number the server allows', async () => {
        const wrapper = await mountCard(answer({ limits: { atOnce: 5, paused: false, directTasks: 10 } }));
        expect(apiRequest).toHaveBeenCalledWith('get', URL, undefined);
        expect(select(wrapper).element.value).toBe('5');
        expect(select(wrapper).findAll('option').map((option) => option.element.value)).toEqual(Array.from({ length: 20 }, (_, index) => String(index + 1)));
        expect(wrapper.find('[data-test="paused-note"]').exists()).toBe(false);
        expect(pauseButton(wrapper).exists()).toBe(true);
        expect(resumeButton(wrapper).exists()).toBe(false);
    });

    it('saves the limit as a number the moment it is chosen', async () => {
        const wrapper = await mountCard();
        await select(wrapper).setValue('2');
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('put', URL, { atOnce: 2 });
        expect(select(wrapper).element.value).toBe('2');
        expect(toast.success).toHaveBeenCalledWith('AgentLimits.saved', expect.anything());
    });

    it('shows how many tasks an agent changes on its own, with every number the server allows, and saves the one chosen', async () => {
        const wrapper = await mountCard(answer({ limits: { atOnce: 3, paused: false, directTasks: 25 } }));
        expect(directTasks(wrapper).element.value).toBe('25');
        expect(directTasks(wrapper).findAll('option').map((option) => option.element.value)).toEqual(Array.from({ length: 100 }, (_, index) => String(index + 1)));
        expect(wrapper.find(`label[for="${directTasks(wrapper).attributes('id')}"]`).text()).toBe('AgentLimits.direct_tasks_label');
        expect(wrapper.find(`#${directTasks(wrapper).attributes('aria-describedby')}`).text()).toBe('AgentLimits.direct_tasks_about');
        await directTasks(wrapper).setValue('40');
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('put', URL, { directTasks: 40 });
        expect(directTasks(wrapper).element.value).toBe('40');
        expect(select(wrapper).element.value).toBe('3');
        expect(toast.success).toHaveBeenCalledWith('AgentLimits.saved', expect.anything());
    });

    it('puts the old count back when the server refuses it, and leaves it out when the server names no range for it', async () => {
        const wrapper = await mountCard(answer(), () => refused('directTasks must be a whole number from 1 to 100.'));
        await directTasks(wrapper).setValue('99');
        await flushPromises();
        expect(directTasks(wrapper).element.value).toBe('10');
        expect(wrapper.find('[data-test="error"]').text()).toBe('directTasks must be a whole number from 1 to 100.');
        const older = await mountCard(answer({ directTasksRange: undefined }));
        expect(directTasks(older).exists()).toBe(false);
        expect(select(older).exists()).toBe(true);
    });

    it('pauses all agents with one button, says so on the card, and offers to resume', async () => {
        const wrapper = await mountCard();
        await pauseButton(wrapper).trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('put', URL, { paused: true });
        expect(wrapper.find('[data-test="paused-note"]').text()).toBe('AgentLimits.paused_note');
        expect(wrapper.find('[data-test="paused-note"]').attributes('role')).toBe('status');
        expect(pauseButton(wrapper).exists()).toBe(false);
        await resumeButton(wrapper).trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('put', URL, { paused: false });
        expect(wrapper.find('[data-test="paused-note"]').exists()).toBe(false);
    });

    it('a person who cannot change them reads both, with no control to use', async () => {
        const wrapper = await mountCard(answer({ limits: { atOnce: 4, paused: true, directTasks: 10 }, canEdit: false }));
        expect(select(wrapper).element.disabled).toBe(true);
        expect(select(wrapper).element.value).toBe('4');
        expect(directTasks(wrapper).element.disabled).toBe(true);
        expect(wrapper.find('[data-test="paused-note"]').exists()).toBe(true);
        expect(pauseButton(wrapper).exists()).toBe(false);
        expect(resumeButton(wrapper).exists()).toBe(false);
        expect(wrapper.find('[data-test="read-only"]').text()).toBe('AgentLimits.read_only');
    });

    it('puts the old value back and says why when the server refuses', async () => {
        const wrapper = await mountCard(answer(), () => refused('Owner/admin only.'));
        await select(wrapper).setValue('9');
        await flushPromises();
        expect(select(wrapper).element.value).toBe('3');
        expect(wrapper.find('[data-test="error"]').text()).toBe('Owner/admin only.');
        expect(wrapper.find('[data-test="error"]').attributes('role')).toBe('alert');
        await pauseButton(wrapper).trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="paused-note"]').exists()).toBe(false);
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('says so when the settings cannot be loaded, and loads again for another project', async () => {
        apiRequest.mockImplementation(() => refused('Project not found.'));
        const wrapper = mount(ProjectAgentLimitsCard, { props: { projectId: 'p1' }, global: { mocks: { $t: (key) => key } } });
        await flushPromises();
        expect(wrapper.find('[data-test="error"]').text()).toBe('Project not found.');
        expect(select(wrapper).exists()).toBe(false);
        apiRequest.mockImplementation(() => ok(answer()));
        await wrapper.setProps({ projectId: 'p2' });
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('get', '/api/v2/agents/project-limits/p2', undefined);
        expect(select(wrapper).exists()).toBe(true);
    });

    it('labels the select, and every string it shows is in the English locale', async () => {
        const wrapper = await mountCard();
        expect(wrapper.find(`label[for="${select(wrapper).attributes('id')}"]`).text()).toBe('AgentLimits.at_once_label');
        const used = [...SOURCE.matchAll(/AgentLimits\.([a-z_]+)/g)].map((match) => match[1]);
        expect(used.length).toBeGreaterThan(8);
        used.forEach((key) => expect(en.AgentLimits[key], key).toEqual(expect.any(String)));
    });

    it('is built from design tokens, wraps on a phone, and sits beside the other agent settings of a project', () => {
        const style = SOURCE.slice(SOURCE.indexOf('<style'));
        expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(style).not.toMatch(/--ink-3/);
        expect(style).not.toMatch(/bg-white/);
        expect(style).toMatch(/flex-wrap:\s*wrap/);
        expect(style).toMatch(/min-height:\s*(3[2-9]|4\d)px/);
        expect(DETAIL).toMatch(/<ProjectAgentPolicyCard[\s\S]*?\/>\s*<ProjectAgentLimitsCard\s+v-if="checkPermission\('project\.project_details',projectData\.isGlobalPermission\) !== null && projectData\?\._id && !projectData\.isPersonal"/);
    });
});
