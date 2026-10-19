import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

const state = vi.hoisted(() => ({ getters: {} }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: state.getters }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key, te: (key) => key !== 'Demo.industry_unknown' }) }));
vi.mock('@/services', () => ({ apiRequestWithoutCompnay: vi.fn() }));

import DemoBanner from '@/components/atom/DemoBanner/DemoBanner.vue';
import SimulatedChip from '@/components/atom/SimulatedChip/SimulatedChip.vue';
import { shellState } from '@/components/organisms/Shell/shellState';
import { industryKeyOf } from '@/composable/useDemoIndustry';

const FINEDGE = { _id: 'c1', Cst_CompanyName: 'FinEdge Finance', demoShowcase: { by: 'demo-industries', industry: 'finance', guidePageId: 'p1' } };
const SWIFT = { _id: 'c2', Cst_CompanyName: 'SwiftLogix', demoShowcase: { by: 'demo-industries', industry: 'logistics', guidePageId: 'p2' } };
const PLAIN = { _id: 'c3', Cst_CompanyName: 'Acme' };

const mountBanner = (companyId, companies, brand = { demoMode: true }) => {
    state.getters = { 'brandSettingTab/brandSettings': brand, 'settings/companies': companies };
    return mount(DemoBanner, {
        global: {
            mocks: { $t: (key) => key },
            provide: { $companyId: ref(companyId) },
            stubs: { 'router-link': { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } },
        },
    });
};

describe('demo banner in an industry demo company', () => {
    beforeEach(() => { shellState.profileOpen = false; });

    it('names the industry, links its guide and opens the switcher', async () => {
        const wrapper = mountBanner('c1', [FINEDGE, SWIFT, PLAIN]);
        expect(wrapper.find('[data-test="demo-industry"]').text()).toBe('Demo.industry_finance');
        expect(JSON.parse(wrapper.find('[data-test="demo-guide"]').attributes('data-to'))).toEqual({ name: 'PageEditor', params: { cid: 'c1', pageId: 'p1' } });
        await wrapper.find('[data-test="demo-switch"]').trigger('click');
        expect(shellState.profileOpen).toBe(true);
    });

    it('offers no switch when this is the only industry company', () => {
        const wrapper = mountBanner('c1', [FINEDGE, PLAIN]);
        expect(wrapper.find('[data-test="demo-industry"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="demo-switch"]').exists()).toBe(false);
    });

    it('stays the plain banner in an ordinary company', () => {
        const wrapper = mountBanner('c3', [FINEDGE, SWIFT, PLAIN]);
        expect(wrapper.find('.demo-banner').exists()).toBe(true);
        expect(wrapper.find('[data-test="demo-industry"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="demo-guide"]').exists()).toBe(false);
    });

    it('shows nothing when demo mode is off', () => {
        const wrapper = mountBanner('c1', [FINEDGE, SWIFT], { demoMode: false });
        expect(wrapper.find('.demo-banner').exists()).toBe(false);
    });
});

describe('demo industry helpers', () => {
    it('reads the key from a full row or the login list', () => {
        expect(industryKeyOf(FINEDGE)).toBe('finance');
        expect(industryKeyOf({ demoIndustry: 'hr' })).toBe('hr');
        expect(industryKeyOf(PLAIN)).toBe('');
        expect(industryKeyOf(null)).toBe('');
    });

    it('labels a simulated record and explains it to a screen reader', () => {
        const wrapper = mount(SimulatedChip, { global: { mocks: { $t: (key) => key } } });
        expect(wrapper.text()).toContain('Demo.simulated');
        expect(wrapper.find('.ah-sr-only').text()).toContain('Demo.simulated_hint');
        expect(wrapper.attributes('title')).toBe('Demo.simulated_hint');
    });
});
