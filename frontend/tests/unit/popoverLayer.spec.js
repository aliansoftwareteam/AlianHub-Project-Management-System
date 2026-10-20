import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';

const ids = vi.hoisted(() => ({ next: 0 }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ debounce: (fn) => fn, makeUniqueId: () => `u${++ids.next}` }),
}));

import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
import { providePopoverLayer } from '@/composable/popoverLayer';

const PICKERS = `
    <DropDown mode="listbox" id="source" title="Source">
        <template #button>Source</template>
        <template #options><DropDownOption @click="picked = 'upwork'">Upwork</DropDownOption></template>
    </DropDown>
    <Sidebar v-model:visible="drawer" title="Choose people" :options="[]" />`;

const Dialog = defineComponent({
    components: { DropDown, DropDownOption, Sidebar },
    props: { withLayer: Boolean },
    setup(props) {
        const layer = props.withLayer ? providePopoverLayer() : ref(null);
        return { layer, drawer: ref(false), picked: ref('') };
    },
    template: `<div class="dialog">${PICKERS}<div ref="layer" class="dialog__layer"></div></div>`
});

let wrapper;
const hosts = ['my-dropdown', 'my-sidebar'];

beforeEach(() => {
    hosts.forEach((id) => {
        const host = document.createElement('div');
        host.id = id;
        document.body.appendChild(host);
    });
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

const mountDialog = (withLayer) => {
    wrapper = mount(Dialog, { props: { withLayer }, attachTo: document.body });
    return wrapper;
};

const openPickers = async () => {
    await wrapper.find('[data-dropdown-trigger]').trigger('click');
    wrapper.vm.drawer = true;
    await flushPromises();
};

describe('popover layer', () => {
    it('renders a dialog\'s dropdown and drawer inside the layer it provides', async () => {
        mountDialog(true);
        await openPickers();

        const layer = document.querySelector('.dialog__layer');
        expect(layer.querySelector('[role="listbox"]')).not.toBeNull();
        expect(layer.querySelector('.sidebar-content')).not.toBeNull();
        expect(document.getElementById('my-dropdown').children).toHaveLength(0);
        expect(document.getElementById('my-sidebar').children).toHaveLength(0);
    });

    it('keeps the global hosts for pickers outside such a dialog', async () => {
        mountDialog(false);
        await openPickers();

        expect(document.querySelector('.dialog__layer').children).toHaveLength(0);
        expect(document.getElementById('my-dropdown').querySelector('[role="listbox"]')).not.toBeNull();
        expect(document.getElementById('my-sidebar').querySelector('.sidebar-content')).not.toBeNull();
    });

    it('an option picked in the layer still reaches the dialog', async () => {
        mountDialog(true);
        await openPickers();

        document.querySelector('.dialog__layer [role="option"]').click();
        expect(wrapper.vm.picked).toBe('upwork');
    });
});
