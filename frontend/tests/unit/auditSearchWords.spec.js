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
        expect(searchKeys(() => many, 'same').qEvents.split(',')).toHaveLength(40);
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

    it('sends no keys with an empty search', async () => {
        mount(AuditLog, { global: { mocks: { $t: t } } });
        await flushPromises();
        expect([...lastQuery().keys()].filter((key) => key.startsWith('q'))).toEqual([]);
    });
});
