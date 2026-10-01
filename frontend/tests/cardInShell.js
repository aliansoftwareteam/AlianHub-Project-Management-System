import { flushPromises, mount } from '@vue/test-utils';
import { h, ref } from 'vue';
import { vi } from 'vitest';
import DashboardCard from '@/components/organisms/DashboardCard/DashboardCard.vue';

export const CATALOG_EMPTY_TEXT = 'catalogue empty text';

const RouterLink = { name: 'RouterLink', props: ['to'], render() { return h('a', this.$slots.default && this.$slots.default()); } };
export const ApexChart = { name: 'ApexChart', props: ['series', 'options', 'type', 'height'], render: () => h('div', { 'data-test': 'apex' }) };

export const settle = async () => {
    await vi.dynamicImportSettled();
    await flushPromises();
};

/* A card body is only ever seen through DashboardCard, so a body mounted alone proves nothing about
   what a dashboard shows: these helpers mount the real shell around the real body and read the result. */
export function mountInShell(body, { props = {}, shell = {}, global = {} } = {}) {
    const refreshes = ref(0);
    const shellProps = ref(shell);
    const refresh = () => { refreshes.value += 1; };
    const Host = {
        name: 'CardHost',
        inheritAttrs: false,
        setup: (_, { attrs }) => () => h(DashboardCard, {
            title: 'Card',
            showRefresh: true,
            emptyText: CATALOG_EMPTY_TEXT,
            onRefresh: refresh,
            onRetry: refresh,
            ...shellProps.value,
        }, {
            default: () => h(body, { cardUID: 'c1', ...attrs, refreshTrigger: Number(attrs.refreshTrigger || 0) + refreshes.value }),
        }),
    };
    const wrapper = mount(Host, { attrs: props, global: { ...global, stubs: { ApexChart, RouterLink, ...(global.stubs || {}) } } });
    return { wrapper, shown: shown(wrapper), refresh, setShell: (next) => { shellProps.value = next; } };
}

export function shown(wrapper) {
    const has = (name) => wrapper.find(`[data-test="dcard-${name}"]`).exists();
    const textOf = (name) => {
        const el = wrapper.find(`[data-test="dcard-${name}"] .dcard__state-text`);
        return el.exists() ? el.text() : '';
    };
    return {
        get state() {
            if (has('skeleton')) return 'loading';
            if (has('error')) return 'error';
            if (has('empty')) return 'empty';
            return this.bodyHidden ? 'covered' : 'ready';
        },
        get bodyHidden() { return wrapper.find('[data-test="dcard-content"]').attributes('aria-hidden') === 'true'; },
        get bodyMounted() { return has('content') && wrapper.find('[data-test="dcard-content"]').element.children.length > 0; },
        get emptyText() { return textOf('empty'); },
        get error() { return textOf('error'); },
        get note() { return wrapper.find('.dcard__note').text(); },
    };
}

export const clickRefresh = (wrapper) => wrapper.find('.dcard__tool[title="Dash.refresh"]').trigger('click');
export const clickRetry = (wrapper) => wrapper.find('[data-test="dcard-retry"]').trigger('click');
