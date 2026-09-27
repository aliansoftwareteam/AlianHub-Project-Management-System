import { describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import en from '@/locales/en.js';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import ProvenanceRollup from '@/components/molecules/Provenance/ProvenanceRollup.vue';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
i18n.global.locale = 'en';

const rollup = (closed) => ({
    sprint: { id: 's1', name: 'Sprint 7' },
    closed,
    completed: closed,
    unchecked: 0,
    byPattern: { HUMAN: { tasks: closed, points: 0, hours: 0 } }
});

const noteFor = async (closed) => {
    apiRequest.mockResolvedValue({ data: { status: true, data: rollup(closed) } });
    const wrapper = mount(ProvenanceRollup, { props: { sprintId: 's1' }, global: { mocks: { $t: i18n.global.t } } });
    await flushPromises();
    return wrapper.find('.pv-roll__note').text();
};

describe('the provenance rollup note', () => {
    it('says "1 task closed" for one task', async () => {
        expect(await noteFor(1)).toBe('1 task closed');
    });

    it('says "3 tasks closed" for several', async () => {
        expect(await noteFor(3)).toBe('3 tasks closed');
    });
});
