import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => null }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import AuditLog from '@/views/Settings/Audit/AuditLog.vue';
import { searchKeys } from '@/views/Ai/auditWords';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const inEnglish = (namespace) => en[namespace];
const none = { data: { status: true, data: [], metadata: { total: 0, page: 1, totalPages: 1 } } };
const lastQuery = () => new URLSearchParams(String(apiRequest.mock.calls.at(-1)[1]).split('?')[1]);

beforeEach(() => { apiRequest.mockReset(); apiRequest.mockResolvedValue(none); });

describe('the keys the typed words label in the reader\'s language', () => {
    it('are the events, the actions and the reasons whose words hold them', () => {
        expect(searchKeys(inEnglish, 'role or details')).toEqual({ qEvents: 'member_update' });
        expect(searchKeys(inEnglish, 'Time to undo')).toEqual({ qReasons: 'undo_window_passed' });
        expect(searchKeys(inEnglish, 'pause all agents').qActions.split(',')).toContain('agent_pause_all');
    });

    it('are none when nothing is typed or no words hold it', () => {
        expect(searchKeys(inEnglish, '   ')).toEqual({});
        expect(searchKeys(inEnglish, 'zzzz no such words')).toEqual({});
        expect(searchKeys(() => undefined, 'role')).toEqual({});
    });

    it('are read from the words of the language in use, not from English', () => {
        const french = (namespace) => (namespace === 'AuditEvents' ? { member_update: 'A modifié le rôle d\'un membre' } : {});
        expect(searchKeys(french, 'rôle')).toEqual({ qEvents: 'member_update' });
        expect(searchKeys(french, 'role or details')).toEqual({});
    });

    it('stay a short list however much matches', () => {
        const many = Object.fromEntries(Array.from({ length: 200 }, (unused, at) => [`key_${at}`, 'the same words']));
        expect(searchKeys(() => many, 'same').qEvents.split(',')).toHaveLength(25);
    });
});

describe('searching the audit log', () => {
    it('sends what was typed and the keys its words label', async () => {
        const wrapper = mount(AuditLog, { global: { mocks: { $t: t } } });
        await flushPromises();
        await wrapper.find('.al__search-input').setValue('time to undo');
        await wrapper.find('.al__search-input').trigger('keyup.enter');
        await flushPromises();

        expect(lastQuery().get('q')).toBe('time to undo');
        expect(lastQuery().get('qReasons')).toBe('undo_window_passed');
        expect(lastQuery().has('qEvents')).toBe(false);
    });

    it('searches by itself a moment after the typing stops, and at once on Enter', async () => {
        vi.useFakeTimers();
        try {
            const wrapper = mount(AuditLog, { global: { mocks: { $t: t } } });
            await flushPromises();
            expect(apiRequest).toHaveBeenCalledTimes(1);

            await wrapper.find('.al__search-input').setValue('comm');
            await vi.advanceTimersByTimeAsync(200);
            await wrapper.find('.al__search-input').setValue('comment');
            await vi.advanceTimersByTimeAsync(299);
            expect(apiRequest).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(apiRequest).toHaveBeenCalledTimes(2);
            expect(lastQuery().get('q')).toBe('comment');
            expect(lastQuery().get('page')).toBe('1');

            await wrapper.find('.al__search-input').setValue('member');
            await wrapper.find('.al__search-input').trigger('keyup.enter');
            expect(apiRequest).toHaveBeenCalledTimes(3);
            expect(lastQuery().get('q')).toBe('member');
            await vi.advanceTimersByTimeAsync(1000);
            expect(apiRequest).toHaveBeenCalledTimes(3);
            wrapper.unmount();
        } finally {
            vi.useRealTimers();
        }
    });

    it('shows the rows of the last search asked for, whichever answer comes last', async () => {
        const answer = (action) => ({ data: { status: true, data: [{ _id: action, action, createdAt: '2026-10-02T10:00:00.000Z' }], metadata: { total: 1, page: 1, totalPages: 1 } } });
        const wrapper = mount(AuditLog, { global: { mocks: { $t: t } } });
        await flushPromises();
        let first;
        apiRequest.mockReturnValueOnce(new Promise((resolve) => { first = resolve; }));
        apiRequest.mockResolvedValueOnce(answer('second.search'));
        await wrapper.find('.al__search-input').setValue('one');
        await wrapper.find('.al__search-input').trigger('keyup.enter');
        await wrapper.find('.al__search-input').setValue('two');
        await wrapper.find('.al__search-input').trigger('keyup.enter');
        await flushPromises();
        first(answer('first.search'));
        await flushPromises();
        expect(wrapper.text()).toContain('second.search');
        expect(wrapper.text()).not.toContain('first.search');
        wrapper.unmount();
    });

    it('sends no keys with an empty search', async () => {
        mount(AuditLog, { global: { mocks: { $t: t } } });
        await flushPromises();
        expect([...lastQuery().keys()].filter((key) => key.startsWith('q'))).toEqual([]);
    });
});
