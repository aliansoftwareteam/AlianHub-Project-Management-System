import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

const { push } = vi.hoisted(() => ({ push: vi.fn(() => Promise.resolve()) }));

vi.mock('vue-router', () => ({ useRouter: () => ({ push, hasRoute: () => true }) }));
vi.mock('@/offline', () => ({ retryNow: vi.fn() }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import AppState from '@/components/molecules/AppState/AppState.vue';

const mountState = (props) => mount(AppState, {
    props,
    global: { mocks: { $t: (key) => key }, provide: { $companyId: { value: 'c1' } } },
});

describe('AppState', () => {
    beforeEach(() => push.mockClear());

    it('forbidden offers one working way home instead of a Request access button that did nothing', async () => {
        const wrapper = mountState({ kind: 'forbidden' });
        const buttons = wrapper.findAll('button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0].text()).toBe('Inbox.state_forbidden_secondary');
        await buttons[0].trigger('click');
        expect(push).toHaveBeenCalledWith({ name: 'Home', params: { cid: 'c1' } });
    });

    it('notfound has a single Go home button', async () => {
        const wrapper = mountState({ kind: 'notfound' });
        const buttons = wrapper.findAll('button');
        expect(buttons).toHaveLength(1);
        await buttons[0].trigger('click');
        expect(push).toHaveBeenCalledTimes(1);
    });
});
