/* Task 047, AI-1 leftovers: a view an approved proposal adds shows in the open project's view tabs without a reload. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, defineComponent, h, ref } from 'vue';
import { createStore } from 'vuex';
import fs from 'node:fs';
import path from 'node:path';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));

import * as mutations from '@/store/ProjectData/mutations';
import projectData from '@/store/ProjectData/index';
import { GATHER_MS, PROJECT_CHANGED_EVENT, useLiveProjects, useStoredProjectViews } from '@/views/Projects/liveProjects';
import { splitProjectViews } from '@/views/Projects/composables/projectViewBar';

const PAGE = fs.readFileSync(path.resolve(__dirname, '../../src/views/Projects/Projects.vue'), 'utf8');
const APP = fs.readFileSync(path.resolve(__dirname, '../../src/App.vue'), 'utf8');
const COMPANY = 'c1';
const LIST = { _id: '6f00000000000000000000a1', id: '6f00000000000000000000a1', keyName: 'ProjectListView', name: 'List', title: 'List', viewStatus: true };
const BY_STAGE = { ...LIST, _id: '6f00000000000000000000a2', id: '6f00000000000000000000a2', title: 'By Stage', sourceViewId: LIST._id };
const project = (views) => ({ _id: 'p1', id: 'p1', ProjectName: 'Alpha', statusType: 'active', AssigneeUserId: [], sprintsObj: {}, sprintsfolders: {}, ProjectRequiredComponent: views });

let handlers;
let socket;
let store;
let page;
let wrapper;

const mountPage = () => {
    handlers = {};
    socket = ref({ on: (event, handler) => { handlers[event] = handler; }, off: () => {} });
    store = createStore({ modules: { projectData: { namespaced: true, state: () => ({ allProjects: { data: [project([LIST])] }, sprints: {}, folders: {} }), getters: projectData.getters, mutations } } });
    const Host = defineComponent({
        setup() {
            useLiveProjects(socket, computed(() => COMPANY), () => 'p1');
            page = ref({ ...project([LIST]) });
            useStoredProjectViews(page);
            return () => h('div', splitProjectViews(page.value.ProjectRequiredComponent).views.map((view) => h('span', { class: 'tab' }, view.title)));
        },
    });
    wrapper = mount(Host, { global: { plugins: [store] } });
};

const tabs = () => wrapper.findAll('.tab').map((tab) => tab.text());

beforeEach(() => {
    vi.useFakeTimers();
    apiRequest.mockReset();
    mountPage();
});
afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
});

describe('a view added elsewhere', () => {
    it('shows in the open project\'s tabs once the project is told it changed', async () => {
        expect(tabs()).toEqual(['List']);
        apiRequest.mockResolvedValue({ data: project([LIST, BY_STAGE]) });
        handlers[PROJECT_CHANGED_EVENT]({ kind: 'changed', companyId: COMPANY, projectId: 'p1' });
        await vi.advanceTimersByTimeAsync(GATHER_MS);
        await flushPromises();
        expect(tabs()).toEqual(['List', 'By Stage']);
        expect(page.value.ProjectName).toBe('Alpha');
    });

    it('leaves the page\'s copy alone while the stored views are the ones it shows', async () => {
        const before = page.value;
        store.state.projectData.allProjects.data[0].ProjectName = 'Alpha, renamed';
        await flushPromises();
        expect(page.value).toBe(before);
    });

    it('shows when it was added while the tab was hidden and its socket dropped', async () => {
        socket.value = null;
        await flushPromises();
        apiRequest.mockResolvedValue({ data: project([LIST, BY_STAGE]) });
        socket.value = { on: (event, handler) => { handlers[event] = handler; }, off: () => {} };
        await vi.advanceTimersByTimeAsync(GATHER_MS);
        await flushPromises();
        expect(tabs()).toEqual(['List', 'By Stage']);
    });

    it('costs no read when the first socket connects', async () => {
        wrapper.unmount();
        apiRequest.mockReset();
        mountPage();
        await vi.advanceTimersByTimeAsync(GATHER_MS);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('is followed by the shell, which drops its socket on a hidden tab and names the open project', () => {
        expect(APP).toMatch(/document\.hidden[\s\S]*?emit\('disconnectNameSpace'/);
        expect(APP).toMatch(/useLiveProjects\(socket, companyId, \(\) => route\.params\?\.id\)/);
    });

    it('is wired into the project page', () => {
        expect(PAGE).toMatch(/useStoredProjectViews\(projectData\)/);
    });
});
