import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent, ref } from 'vue';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({
    useRoute: () => ({ name: 'Home', path: '/c1/home' }),
    useRouter: () => ({ hasRoute: () => true })
}));
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: () => true }) }));

import { AI_ACCESS, aiAccessFor, aiReachable, aiUsable, applyAiAvailability, canUseAi, loadAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';
import { useNavItems } from '@/components/organisms/Shell/navItems';

const WITH_AI = { _id: 'p1', apps: [{ key: 'AI' }] };
const WITH_AI_STRING = { _id: 'p2', apps: ['AI'] };
const WITHOUT_AI = { _id: 'p3', apps: [{ key: 'Priority' }] };

const known = (state, planAllowsAi = true) => ({ state, planAllowsAi, loaded: true });

const TABLE = [
    ['not loaded yet', { planAllowsAi: true }, {}, AI_ACCESS.UNKNOWN],
    ['on, plan still loading', { state: 'on', planAllowsAi: null }, {}, AI_ACCESS.UNKNOWN],
    ['on', known('on'), {}, AI_ACCESS.USABLE],
    ['off for the instance', known('off_instance'), {}, AI_ACCESS.OFF],
    ['off for the workspace', known('off_workspace'), {}, AI_ACCESS.OFF],
    ['off beats a missing plan', known('off_workspace', false), {}, AI_ACCESS.OFF],
    ['no provider', known('unconfigured'), {}, AI_ACCESS.UNCONFIGURED],
    ['plan without AI', known('on', false), {}, AI_ACCESS.NOT_PERMITTED],
    ['role says no', known('on'), { permitted: false }, AI_ACCESS.NOT_PERMITTED],
    ['role says yes', known('on'), { permitted: true }, AI_ACCESS.USABLE],
    ['project has the AI app', known('on'), { project: WITH_AI }, AI_ACCESS.USABLE],
    ['project lists the AI app by name', known('on'), { project: WITH_AI_STRING }, AI_ACCESS.USABLE],
    ['project without the AI app', known('on'), { project: WITHOUT_AI }, AI_ACCESS.NOT_PERMITTED],
    ['project not loaded', known('on'), { project: null }, AI_ACCESS.NOT_PERMITTED],
    ['off wins over a project without the app', known('off_instance'), { project: WITHOUT_AI }, AI_ACCESS.OFF],
    ['the read failed, so the server decides', { state: 'unknown', planAllowsAi: true, loaded: true }, {}, AI_ACCESS.USABLE]
];

describe('one AI access state per context', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        resetAiAvailability();
    });

    it.each(TABLE)('%s', (_name, availability, ctx, expected) => {
        applyAiAvailability(availability);
        expect(aiAccessFor(ctx)).toBe(expected);
        expect(canUseAi(ctx)).toBe(expected === AI_ACCESS.USABLE);
    });

    it('shows no AI entry point before the server has answered, so none flashes on and then off', () => {
        applyAiAvailability({ planAllowsAi: true });
        expect(canUseAi()).toBe(false);
        expect(aiUsable.value).toBe(false);
        expect(aiReachable.value).toBe(false);
    });

    it('keeps the AI screens reachable without a provider and hides them only while off', () => {
        for (const [state, reachable] of [['on', true], ['unconfigured', true], ['off_instance', false], ['off_workspace', false]]) {
            applyAiAvailability(known(state));
            expect(aiReachable.value).toBe(reachable);
        }
    });

    it('marks the state known once the read fails, and lets the server refuse what is off', async () => {
        apiRequest.mockImplementation(() => Promise.reject(new Error('network')));
        applyAiAvailability({ planAllowsAi: true });
        await loadAiAvailability('c1');
        expect(aiAccessFor()).toBe(AI_ACCESS.USABLE);
        expect(aiReachable.value).toBe(true);
    });
});

const Harness = defineComponent({
    setup() {
        return useNavItems(ref('c1'));
    },
    render: () => null
});

const mountNav = () => mount(Harness, {
    global: {
        plugins: [createStore({
            getters: {
                'settings/rules': () => ({ project: {} }),
                'settings/companyUserDetail': () => ({ roleType: 1 }),
                'brandSettingTab/brandSettings': () => ({})
            }
        })]
    }
});

const railKeys = (wrapper) => wrapper.vm.rail.map((item) => item.key);
const moreKeys = (wrapper) => wrapper.vm.more.flatMap((group) => group.items.map((item) => item.key));

describe('the AI rail tile and talk-to-text', () => {
    beforeEach(() => resetAiAvailability());

    it('hides the AI tile and talk-to-text while AI is off', () => {
        applyAiAvailability(known('off_workspace'));
        const wrapper = mountNav();
        expect(railKeys(wrapper)).not.toContain('ai');
        expect(moreKeys(wrapper)).not.toContain('talk');
    });

    it('hides both until the state is known', () => {
        const wrapper = mountNav();
        expect(railKeys(wrapper)).not.toContain('ai');
        expect(moreKeys(wrapper)).not.toContain('talk');
    });

    it('keeps the AI tile without a provider, where the screens explain themselves, but not talk-to-text', () => {
        applyAiAvailability(known('unconfigured'));
        const wrapper = mountNav();
        expect(railKeys(wrapper)).toContain('ai');
        expect(moreKeys(wrapper)).not.toContain('talk');
    });

    it('hides talk-to-text when the plan has no AI', () => {
        applyAiAvailability(known('on', false));
        expect(moreKeys(mountNav())).not.toContain('talk');
    });

    it('shows both when AI is usable', () => {
        applyAiAvailability(known('on'));
        const wrapper = mountNav();
        expect(railKeys(wrapper)).toContain('ai');
        expect(moreKeys(wrapper)).toContain('talk');
    });
});
