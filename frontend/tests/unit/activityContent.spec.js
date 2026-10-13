import { describe, expect, it, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';

vi.mock('vuex', () => ({ useStore: () => ({ getters: {} }), createStore: () => ({}) }));
vi.mock('@/composable/projects', () => ({ useProjects: () => ({ getDateAndTime: () => 'when' }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({ timeFormat: 24 }) }), useCustomComposable: () => ({}) }));

import ActivityContent from '@/components/molecules/ActivityLogContent/ActivityContent.vue';

const mountWith = (Message) => shallowMount(ActivityContent, {
    props: { data: { Message, userData: {}, createdAt: 1 } },
    global: { provide: { $dateFormat: { value: 'DD/MM/YYYY' } } },
});

const message = (wrapper) => wrapper.findAll('.wrapperNameImage > span')[0];

describe('ActivityContent', () => {
    it('shows markup inside a stored activity message as text', () => {
        const wrapper = mountWith('<b>Max</b> renamed the task to <img src=x onerror="alert(1)"><a href="javascript:alert(2)">x</a>');
        expect(wrapper.element.querySelectorAll('img, a, [onerror]')).toHaveLength(0);
        expect(message(wrapper).text()).toContain('<img src=x onerror="alert(1)">');
        expect(message(wrapper).find('b').text()).toBe('Max');
    });

    it('keeps the app bold and paragraph markup and formats timestamps', () => {
        const wrapper = mountWith('<p><b>Max</b> logged time at TIMESTAMP_0</p>');
        expect(message(wrapper).find('p b').text()).toBe('Max');
        expect(message(wrapper).text()).not.toContain('TIMESTAMP_');
    });

    it('shows names the server escaped once as their characters', () => {
        const wrapper = mountWith('<b>Tom &amp; Jerry</b> has attached <b>&lt;report&gt; &#39;v2&#39; &#40;final&#41;</b>.');
        expect(message(wrapper).text()).toBe('Tom & Jerry has attached <report> \'v2\' (final).');
        expect(wrapper.element.querySelector('report')).toBeNull();
    });

    it('keeps an older checklist message bold without its attributes', () => {
        const wrapper = mountWith('<b>Max</b> has created new checklist item <b class="text-ellipsis" style="max-width:150px" title="Buy milk">Buy milk</b>');
        const bolds = message(wrapper).findAll('b');
        expect(bolds.map((b) => b.text())).toEqual(['Max', 'Buy milk']);
        expect(bolds[1].attributes()).toEqual({});
    });
});
