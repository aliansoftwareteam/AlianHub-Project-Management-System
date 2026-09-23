import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import moment from 'moment';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => null }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import AuditLog from '@/views/Settings/Audit/AuditLog.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const row = (id, createdAt) => ({ _id: id, action: 'member.update', actorId: 'u1', actorName: 'Olivia Owner', createdAt, meta: {} });

beforeEach(() => { apiRequest.mockReset(); });

describe('the audit log time column', () => {
    it('shows the clock for a row from today and adds the day for an older row', async () => {
        const today = moment().startOf('day').add(9, 'hours').add(5, 'minutes');
        const older = moment().subtract(3, 'days').startOf('day').add(14, 'hours').add(30, 'minutes');
        apiRequest.mockResolvedValue({ data: { status: true, data: [row('a', today.toISOString()), row('b', older.toISOString())], metadata: { total: 2, page: 1, totalPages: 1 } } });
        const wrapper = mount(AuditLog, { global: { mocks: { $t: t } } });
        await flushPromises();

        const times = wrapper.findAll('.al__time .ah-mono').map((cell) => cell.text());
        expect(times).toEqual(['09:05', older.format('D MMM HH:mm')]);
    });
});
