import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutCompnay, push } = vi.hoisted(() => ({
    apiRequestWithoutCompnay: vi.fn(),
    push: vi.fn(() => new Promise(() => {})),
}));

const t = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

vi.mock('@/services', () => ({ apiRequestWithoutCompnay, useAuth: () => ({ logOut: vi.fn() }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ makeUniqueId: () => 'abc', debounce: (fn) => fn }),
    useGetterFunctions: () => ({ getUser: () => ({}) }),
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push, replace: vi.fn(() => Promise.resolve()) }) }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: { 'settings/companies': [] }, commit: vi.fn() }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/templates/AuthShell/AuthShell.vue', () => ({ default: { name: 'AuthShell', template: '<div><slot name="top-right" /><slot /></div>' } }));

import CreateCompany from '@/views/Company/CreateCompany.vue';
import en from '@/locales/en';
import { CREATE_COMPANY } from '@/config/env';
import { connectAiWelcomePath } from '@/router/ai/connect';

const streams = [];
class FakeEventSource {
    constructor(url) {
        this.url = url;
        this.closed = false;
        streams.push(this);
    }
    close() { this.closed = true; }
    say(data) { this.onmessage({ data: JSON.stringify({ data }) }); }
}

let reply;
const creations = () => apiRequestWithoutCompnay.mock.calls.filter(([method, url]) => method === 'post' && url === CREATE_COMPANY);

const openLastStep = async () => {
    const wrapper = mount(CreateCompany, {
        global: { mocks: { $t: t }, provide: { $userId: ref(''), $companyId: ref('') } },
    });
    await flushPromises();
    await wrapper.find('#ws-name').setValue('Acme Studio');
    await wrapper.find('form').trigger('submit');
    return wrapper;
};
const button = (wrapper, label) => wrapper.findAll('button').find((b) => b.text() === label);
const skip = (wrapper) => button(wrapper, 'Auth.skip_blank').trigger('click');
const onLastStep = (wrapper) => wrapper.text().includes('Auth.focus_title');

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    streams.length = 0;
    localStorage.clear();
    localStorage.setItem('userId', 'user-1');
    push.mockClear();
    reply = () => new Promise(() => {});
    apiRequestWithoutCompnay.mockReset();
    apiRequestWithoutCompnay.mockImplementation((method) => (method === 'get' ? Promise.resolve({ data: { Employee_Email: 'sia@example.test' } }) : reply()));
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('the last sign-up step while the workspace is being made', () => {
    it('shows it is working at once, with nothing left to press twice', async () => {
        const wrapper = await openLastStep();
        await skip(wrapper);

        expect(onLastStep(wrapper)).toBe(false);
        expect(wrapper.find('[role="status"]').text()).toContain('Auth.creating_workspace');
        expect(wrapper.find('.av2-progress').exists()).toBe(true);
        expect(wrapper.findAll('button')).toHaveLength(0);
        expect(creations()).toHaveLength(1);
        expect(creations()[0][2]).toMatchObject({ companyName: 'Acme Studio', seedSampleProject: false, teamFocus: '' });
    });

    it('opens the workspace from the reply alone, when no progress message ever arrives', async () => {
        reply = () => Promise.resolve({ data: { status: true, companyId: 'c9' } });
        const wrapper = await openLastStep();
        await skip(wrapper);
        await flushPromises();
        vi.advanceTimersByTime(600);

        expect(push).toHaveBeenCalledWith(connectAiWelcomePath('c9'));
        expect(localStorage.getItem('selectedCompany')).toBe('c9');
        expect(streams[0].closed).toBe(true);
        expect(wrapper.text()).toContain('Auth.workspace_ready');
    });

    it('opens the workspace once when the progress message and the reply both say it is made', async () => {
        let answer;
        reply = () => new Promise((resolve) => { answer = resolve; });
        const wrapper = await openLastStep();
        await skip(wrapper);
        streams[0].say({ step: 1 });
        streams[0].say({ step: 100, companyId: 'c9' });
        answer({ data: { status: true, companyId: 'c9' } });
        await flushPromises();
        vi.advanceTimersByTime(600);

        expect(push).toHaveBeenCalledTimes(1);
        expect(push).toHaveBeenCalledWith(connectAiWelcomePath('c9'));
    });

    it('keeps waiting for the reply when the progress stream drops, because the workspace may still be made', async () => {
        let answer;
        reply = () => new Promise((resolve) => { answer = resolve; });
        const wrapper = await openLastStep();
        await skip(wrapper);
        streams[0].onerror();
        await flushPromises();

        expect(streams[0].closed).toBe(true);
        expect(onLastStep(wrapper)).toBe(false);
        expect(wrapper.find('[role="status"]').exists()).toBe(true);

        answer({ data: { status: true, companyId: 'c9' } });
        await flushPromises();
        vi.advanceTimersByTime(600);
        expect(push).toHaveBeenCalledWith(connectAiWelcomePath('c9'));
    });
});

describe('the last sign-up step when the workspace is not made', () => {
    const banner = (wrapper) => wrapper.find('[role="alert"]');

    it('comes back to the step and shows the reason the server gave', async () => {
        reply = () => Promise.resolve({ data: { status: false, statusText: 'The server could not set up the workspace.' } });
        const wrapper = await openLastStep();
        await skip(wrapper);
        await flushPromises();

        expect(onLastStep(wrapper)).toBe(true);
        expect(banner(wrapper).text()).toBe(t('Auth.workspace_failed_reason', { reason: 'The server could not set up the workspace.' }));
        expect(button(wrapper, 'Auth.skip_blank').exists()).toBe(true);
        expect(push).not.toHaveBeenCalled();
    });

    it('shows the reason that came on the progress stream, and is not overwritten by the reply after it', async () => {
        let answer;
        reply = () => new Promise((resolve) => { answer = resolve; });
        const wrapper = await openLastStep();
        await skip(wrapper);
        streams[0].say({ step: 100, error: 'The server could not set up the workspace.' });
        answer({ data: { status: false, statusText: 'Another sentence.' } });
        await flushPromises();

        expect(banner(wrapper).text()).toBe(t('Auth.workspace_failed_reason', { reason: 'The server could not set up the workspace.' }));
    });

    it('says the free workspace is already used, in the page\'s own words', async () => {
        reply = () => Promise.resolve({ data: { status: false, statusText: 'limit', freeCompanyLimitReached: true } });
        const wrapper = await openLastStep();
        await skip(wrapper);
        await flushPromises();

        expect(banner(wrapper).text()).toBe('Auth.free_limit');
    });

    it.each([
        ['the server gives no reason', () => Promise.resolve({ data: { status: false } })],
        ['the request never reaches the server', () => Promise.reject(new Error('Network Error'))],
    ])('says so in general words when %s', async (_, answer) => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        reply = answer;
        const wrapper = await openLastStep();
        await skip(wrapper);
        await flushPromises();

        expect(onLastStep(wrapper)).toBe(true);
        expect(banner(wrapper).text()).toBe('Auth.workspace_failed');
        console.error.mockRestore();
    });

    it('can be tried again, and the old message is gone while it works', async () => {
        reply = () => Promise.resolve({ data: { status: false, statusText: 'The server could not set up the workspace.' } });
        const wrapper = await openLastStep();
        await skip(wrapper);
        await flushPromises();
        reply = () => new Promise(() => {});
        await skip(wrapper);

        expect(banner(wrapper).exists()).toBe(false);
        expect(wrapper.find('[role="status"]').exists()).toBe(true);
        expect(creations()).toHaveLength(2);
    });

    it('has the sentence that carries the server\'s reason', () => {
        expect(en.Auth.workspace_failed_reason).toContain('{reason}');
    });
});
