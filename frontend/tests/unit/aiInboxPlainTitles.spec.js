import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => `t:${key}` } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import AiInbox from '@/views/Ai/AiInbox.vue';

const NOW = new Date('2026-09-28T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const store = createStore({ modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } } } });
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });

const proposal = (id, what, daysAgo) => ({
    _id: id, agentName: 'Reviewer', what, why: 'Because.', status: 'pending',
    createdAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    changes: [{ action: 'task.comment', label: 'Comment on AR-1', reversible: true }]
});

const mountInbox = async (rows) => {
    apiRequest.mockImplementation((type, url) => Promise.resolve(url.includes('/proposals')
        ? { data: { status: true, data: rows, counts: { waiting: rows.length, doneByAi: 0, declined: 0 } } }
        : { data: { status: true, data: {} } }));
    const wrapper = mount(AiInbox, { global: { plugins: [store, i18n], mocks: { $t: i18n.global.t } } });
    await flushPromises();
    return wrapper;
};

describe('AiInbox in plain words', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
    afterEach(() => { vi.useRealTimers(); });

    it('titles a proposal with the skill in words and a pluralised count', async () => {
        const wrapper = await mountInbox([
            proposal('p1', 'pr.summary: 1 change(s) on AR-1', 0),
            proposal('p2', 'brief.parse: 7 change(s) on AP-116', 10)
        ]);
        const titles = wrapper.findAll('.ai-item__what').map((w) => w.text());
        expect(titles).toEqual(['Summarise a pull request · 1 change on AR-1', 'Break a brief into subtasks · 7 changes on AP-116']);
        expect(wrapper.text()).not.toContain('change(s)');
        expect(wrapper.text()).not.toContain('pr.summary');

        await wrapper.findAll('.ai-item')[1].trigger('click');
        expect(wrapper.find('.ai-detail__what').text()).toBe('Break a brief into subtasks · 7 changes on AP-116');
    });

    it('marks only proposals waiting more than three days', async () => {
        const wrapper = await mountInbox([
            proposal('fresh', 'pr.summary: 1 change(s) on AR-1', 1),
            proposal('old', 'brief.parse: 7 change(s) on AP-116', 18)
        ]);
        const items = wrapper.findAll('.ai-item');
        expect(items[0].find('[data-test="proposal-waiting"]').exists()).toBe(false);
        expect(items[1].find('[data-test="proposal-waiting"]').text()).toBe('Waiting 18 days');
    });

    it('sorts by newest or by longest waiting', async () => {
        const wrapper = await mountInbox([
            proposal('new', 'pr.summary: 1 change(s) on AR-1', 0),
            proposal('mid', 'pr.summary: 2 change(s) on AR-2', 5),
            proposal('old', 'pr.summary: 3 change(s) on AR-3', 12)
        ]);
        const order = () => wrapper.findAll('.ai-item__what').map((w) => w.text().split(' on ')[1]);
        expect(order()).toEqual(['AR-1', 'AR-2', 'AR-3']);

        await wrapper.find('[data-test="inbox-sort"]').setValue('oldest');
        expect(order()).toEqual(['AR-3', 'AR-2', 'AR-1']);
    });

    it('names the owner-or-admin gate in words', async () => {
        const wrapper = await mountInbox([{ ...proposal('g', 'pr.summary: 1 change(s) on AR-1', 0), gate: 'owner_admin' }]);
        expect(wrapper.find('.ai-item').text()).not.toContain('GATED');
        expect(wrapper.find('[data-test="proposal-gate"]').text()).toBe('Needs an owner or admin');
    });
});
