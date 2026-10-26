import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { reactive, ref } from 'vue';

vi.mock('vue-router', () => ({ useRoute: () => reactive({ fullPath: '/p' }) }));
vi.mock('@/components/molecules/ProjectTree/ProjectTree.vue', () => ({
    default: { name: 'ProjectTree', props: ['projects', 'label'], render: () => null }
}));

import ProjectTreePanel from '@/views/Projects/components/ProjectTreePanel.vue';
import { projectTreePanelState } from '@/views/Projects/components/projectTreePanelState';

const projects = [
    { _id: 'p1', ProjectName: 'Alian Website', ProjectCode: 'AW' },
    { _id: 'p2', ProjectName: 'Marketing Team Task', ProjectCode: 'MKT' },
    { _id: 'p3', ProjectName: 'Hr - Website Wordpress', ProjectCode: 'HRW' }
];

function mountPanel(width = 1440) {
    projectTreePanelState.collapsed = false;
    const store = createStore({ getters: { 'projectData/projects': () => ({ data: projects }) } });
    return mount(ProjectTreePanel, { global: { plugins: [store], provide: { $clientWidth: ref(width) } } });
}

const names = (wrapper) => {
    const tree = wrapper.findComponent({ name: 'ProjectTree' });
    return tree.exists() ? tree.props('projects').map((p) => p.ProjectName) : [];
};
const search = (wrapper) => wrapper.find('[data-test="project-tree-search"]');

describe('ProjectTreePanel search', () => {
    it('narrows the tree by name or code, ignoring case', async () => {
        const wrapper = mountPanel();
        expect(names(wrapper)).toHaveLength(3);
        await search(wrapper).setValue(' WEBSITE ');
        expect(names(wrapper)).toEqual(['Alian Website', 'Hr - Website Wordpress']);
        await search(wrapper).setValue('mkt');
        expect(names(wrapper)).toEqual(['Marketing Team Task']);
    });

    it('says nothing matched instead of an empty tree', async () => {
        const wrapper = mountPanel();
        await search(wrapper).setValue('zzz');
        expect(wrapper.findComponent({ name: 'ProjectTree' }).exists()).toBe(false);
        expect(wrapper.find('[data-test="project-tree-search-empty"]').exists()).toBe(true);
    });

    it('clears on Escape without closing the drawer, and closes it on the next Escape', async () => {
        projectTreePanelState.open = true;
        const wrapper = mountPanel(800);
        await search(wrapper).setValue('alian');
        await search(wrapper).trigger('keydown', { key: 'Escape' });
        expect(names(wrapper)).toHaveLength(3);
        expect(projectTreePanelState.open).toBe(true);
        await search(wrapper).trigger('keydown', { key: 'Escape' });
        expect(projectTreePanelState.open).toBe(false);
    });
});
