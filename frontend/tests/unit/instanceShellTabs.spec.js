import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { ref } from 'vue';

const route = vi.hoisted(() => ({ name: 'InstanceEgress', params: {} }));
vi.mock('vue-router', () => ({ useRoute: () => route }));
vi.mock('@/views/Settings/Instance/useInstanceApi', () => ({ useInstanceApi: () => ({ guide: (a) => `#${a}` }) }));

import InstanceShell from '@/views/Settings/Instance/InstanceShell.vue';

const source = fs.readFileSync(path.join(__dirname, '../../src/views/Settings/Instance/InstanceShell.vue'), 'utf8');
const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hit = source.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
    return hit ? hit[1] : '';
};

describe('the instance tab strip fits a narrow toolbar', () => {
    it('lets the strip shrink and scroll inside the toolbar instead of widening the page', () => {
        expect(rule('.in__tabs')).toMatch(/min-width: 0/);
        expect(rule('.in__tabs')).toMatch(/overflow-x: auto/);
    });

    it('keeps each tab on one line at its own width', () => {
        expect(rule('.in__tabs .ah-tab')).toMatch(/flex: none/);
        expect(rule('.in__tabs .ah-tab')).toMatch(/white-space: nowrap/);
    });

    it('scrolls the active tab into view within the strip', async () => {
        const reveal = vi.fn();
        const original = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function scrollIntoView(opts) { reveal(this.className, opts); };
        const wrapper = mount(InstanceShell, {
            global: {
                provide: { $companyId: ref('c1') },
                stubs: { RouterLink: { ...RouterLinkStub, template: '<a :class="$attrs.class"><slot /></a>' }, RouterView: true, ShellIcon: true },
                mocks: { $t: (k) => k }
            }
        });
        await flushPromises();
        Element.prototype.scrollIntoView = original;

        expect(reveal).toHaveBeenCalledWith(expect.stringContaining('is-active'), { block: 'nearest', inline: 'nearest' });
        expect(wrapper.find('.is-active').text()).toBe('Egress.nav');
        wrapper.unmount();
    });
});
