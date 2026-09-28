import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, echo } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key)
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/store/index', () => ({ default: { getters: {} } }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }) }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import Approvals from '@/views/Approvals/Approvals.vue';

const PROPOSALS = '/api/v2/agents/proposals';

const proposal = {
    _id: 'p1',
    agentId: 'a1',
    agentName: 'Daily PM',
    what: 'Move two tasks into Sprint 4',
    why: 'Both are blocked on the API work that lands in Sprint 4.',
    changes: [
        { action: 'task.move', label: 'Move AP-12 to Sprint 4', reversible: true },
        { action: 'task.delete', label: 'Delete the duplicate AP-13', reversible: false }
    ],
    status: 'pending',
    createdAt: '2026-09-22T10:00:00.000Z'
};

const respond = (type, url) => {
    if (String(url).startsWith(PROPOSALS)) return Promise.resolve({ data: { status: true, data: [proposal] } });
    return Promise.resolve({ data: { status: true, data: [] } });
};

const store = () => createStore({
    modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } }
});

let wrapper;
const open = async () => {
    apiRequest.mockImplementation(respond);
    wrapper = mount(Approvals, { attachTo: document.body, global: { plugins: [store()], mocks: { $t: echo } } });
    await flushPromises();
    await wrapper.findAll('.tv-tab').find((b) => b.text() === 'Time.filter_ai').trigger('click');
    return wrapper;
};

const whyButton = () => wrapper.find('[data-test="proposal-why"]');
const dialog = () => document.body.querySelector('[role="dialog"]');

describe('Approvals — Why explains an agent proposal', () => {
    beforeEach(() => { apiRequest.mockReset(); });
    afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; });

    it('the Why button says it opens a dialog', async () => {
        await open();
        expect(whyButton().exists()).toBe(true);
        expect(whyButton().attributes('aria-haspopup')).toBe('dialog');
        expect(whyButton().attributes('aria-expanded')).toBe('false');
    });

    it('clicking Why opens the proposal with its reason and changes', async () => {
        await open();
        await whyButton().trigger('click');
        await flushPromises();
        const box = dialog();
        expect(box).not.toBeNull();
        expect(box.getAttribute('aria-modal')).toBe('true');
        const title = document.getElementById(box.getAttribute('aria-labelledby'));
        expect(title).not.toBeNull();
        expect(box.textContent).toContain('Move two tasks into Sprint 4');
        expect(box.textContent).toContain('Both are blocked on the API work that lands in Sprint 4.');
        expect(box.textContent).toContain('Move AP-12 to Sprint 4');
        expect(box.textContent).toContain('Delete the duplicate AP-13');
        expect(box.querySelectorAll('[data-test="why-change-permanent"]')).toHaveLength(1);
        expect(whyButton().attributes('aria-expanded')).toBe('true');
    });

    it('moves focus into the dialog, and Escape closes it and returns focus to Why', async () => {
        await open();
        whyButton().element.focus();
        await whyButton().trigger('click');
        await flushPromises();
        expect(dialog().contains(document.activeElement)).toBe(true);
        dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await flushPromises();
        expect(dialog()).toBeNull();
        expect(document.activeElement).toBe(whyButton().element);
    });

    it('the close button closes it', async () => {
        await open();
        await whyButton().trigger('click');
        await flushPromises();
        dialog().querySelector('[data-test="why-close"]').click();
        await flushPromises();
        expect(dialog()).toBeNull();
    });

    it('renders the reason as text, not markup', async () => {
        apiRequest.mockImplementation((type, url) => (String(url).startsWith(PROPOSALS)
            ? Promise.resolve({ data: { status: true, data: [{ ...proposal, why: '<img src=x onerror=alert(1)>' }] } })
            : respond(type, url)));
        wrapper = mount(Approvals, { attachTo: document.body, global: { plugins: [store()], mocks: { $t: echo } } });
        await flushPromises();
        await whyButton().trigger('click');
        await flushPromises();
        expect(dialog().querySelector('img')).toBeNull();
        expect(dialog().textContent).toContain('<img src=x onerror=alert(1)>');
    });
});
