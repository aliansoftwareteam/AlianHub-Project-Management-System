import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import moment from 'moment';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => null }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import AuditLog from '@/views/Settings/Audit/AuditLog.vue';
import { followClockPrefs } from '@/utils/clockText';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const row = (id, createdAt) => ({ _id: id, action: 'member.update', actorId: 'u1', actorName: 'Olivia Owner', createdAt, meta: {} });

beforeEach(() => { apiRequest.mockReset(); });

describe('the audit log time column', () => {
    const today = () => moment().startOf('day').add(9, 'hours').add(5, 'minutes');
    /* Kept inside the year, so the day is written without it. */
    const older = () => (moment().dayOfYear() > 3 ? moment().subtract(3, 'days') : moment().add(3, 'days')).startOf('day').add(14, 'hours').add(30, 'minutes');
    const timesShown = async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [row('a', today().toISOString()), row('b', older().toISOString())], metadata: { total: 2, page: 1, totalPages: 1 } } });
        const wrapper = mount(AuditLog, { global: { mocks: { $t: t } } });
        await flushPromises();
        return wrapper.findAll('.al__time .ah-mono').map((cell) => cell.text());
    };

    it('shows the clock for a row from today and adds the day for an older row', async () => {
        followClockPrefs({ timeFormat: '24' });
        expect(await timesShown()).toEqual(['09:05', older().format('D MMM, HH:mm')]);
    });

    it('is 12-hour for a person who chose 12-hour time in My Settings', async () => {
        followClockPrefs({ timeFormat: '12' });
        expect(await timesShown()).toEqual(['9:05 AM', older().format('D MMM, h:mm A')]);
        expect((await timesShown())[1]).toMatch(/, 2:30 PM$/);
    });
});

describe('an empty audit log', () => {
    const none = { data: { status: true, data: [], metadata: { total: 0, page: 1, totalPages: 1 } } };

    it('says what the log is for and offers nothing to do', async () => {
        apiRequest.mockResolvedValue(none);
        const wrapper = mount(AuditLog, { global: { mocks: { $t: t } } });
        await flushPromises();
        const empty = wrapper.find('[data-test="audit-empty"]');
        expect(empty.find('h2').text()).toBe(en.Audit.none);
        expect(empty.text()).toContain(en.Audit.none_msg);
        expect(empty.find('button').exists()).toBe(false);
    });

    it('offers to clear a search that matched nothing, and loads again without it', async () => {
        apiRequest.mockResolvedValue(none);
        const wrapper = mount(AuditLog, { global: { mocks: { $t: t } } });
        await flushPromises();
        await wrapper.find('.al__search-input').setValue('nothing like this');
        const empty = wrapper.find('[data-test="audit-empty"]');
        expect(empty.find('svg').attributes('data-illustration')).toBe('search');
        expect(empty.find('.empty-state__btn').text()).toBe(en.Audit.clear_search);

        const calls = apiRequest.mock.calls.length;
        await empty.find('.empty-state__btn').trigger('click');
        await flushPromises();
        expect(wrapper.find('.al__search-input').element.value).toBe('');
        expect(apiRequest.mock.calls.length).toBe(calls + 1);
        expect(wrapper.find('[data-test="audit-empty"] button').exists()).toBe(false);
    });
});
