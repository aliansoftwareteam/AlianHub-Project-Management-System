import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';
import fs from 'fs';
import path from 'path';

const { aiRequest, stub } = vi.hoisted(() => ({
    aiRequest: vi.fn(),
    stub: (name) => ({ default: { name, render: () => null } })
}));

vi.mock('@/composable', () => ({
    useCustomComposable: () => ({
        checkPermission: () => true,
        checkApps: () => true,
        debouncerWithPromise: () => Promise.resolve(),
        debounce: (fn) => fn
    }),
    useGetterFunctions: () => ({ getUser: () => ({}) })
}));
vi.mock('@/composable/aiHelper', () => ({ useAiApiFunction: () => ({ generateAiRequestForFunction: aiRequest }) }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: [] })) }));
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/utils/assigneeOptions', () => ({ subtaskCreateAssignees: () => [] }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));
vi.mock('@/components/atom/CreateTask/CreateTask.vue', () => stub('CreateTask'));
vi.mock('@/components/atom/SpinnerComp/SpinnerComp.vue', () => stub('SpinnerComp'));
vi.mock('@/components/atom/Skelaton/AiSkelaton.vue', () => stub('Skelaton'));

import SubTasks from '@/components/organisms/SubTasks/SubTasks.vue';

function mountSubTasks() {
    const store = createStore({
        getters: {
            'settings/companyOwnerDetail': () => ({}),
            'projectData/gettaskDetailData': () => null,
            'settings/companyUsers': () => []
        }
    });
    return mount(SubTasks, {
        props: { task: { _id: 'task-1', TaskName: 'Launch', rawDescription: '', sprintArray: {} } },
        global: { plugins: [store], provide: { selectedProject: ref({ _id: 'proj-1', isGlobalPermission: false }) } }
    });
}

function modelReplies(text) {
    aiRequest.mockResolvedValue({ status: true, statusText: { data: { statusText: text } } });
}

describe('SubTasks AI suggestions', () => {
    afterEach(() => {
        delete global.generatedListProbe;
        vi.restoreAllMocks();
    });

    it('lists the suggested subtasks without evaluating the reply', async () => {
        const evalSpy = vi.spyOn(global, 'eval');
        modelReplies('[{"title":"Write tests"},{"title":"Ship it"}]');
        const wrapper = mountSubTasks();

        await wrapper.find('.stx__ai').trigger('click');
        await flushPromises();

        expect(wrapper.findAll('.stx__ai-row').map((row) => row.text())).toEqual(['✦ Write tests', '✦ Ship it']);
        expect(wrapper.find('.ah-field__error').exists()).toBe(false);
        expect(evalSpy).not.toHaveBeenCalled();
    });

    it('shows the generation error and never runs a reply that is code', async () => {
        const probe = vi.fn(() => [{ title: 'ran' }]);
        global.generatedListProbe = probe;
        modelReplies('global.generatedListProbe()');
        const wrapper = mountSubTasks();

        await wrapper.find('.stx__ai').trigger('click');
        await flushPromises();

        expect(probe).not.toHaveBeenCalled();
        expect(wrapper.findAll('.stx__ai-row')).toHaveLength(0);
        expect(wrapper.find('.ah-field__error').exists()).toBe(true);
    });
});

describe('task screens that list AI suggestions', () => {
    const sites = [
        'components/organisms/SprinstList/SprintsList.vue',
        'components/organisms/SubTasks/SubTasks.vue',
        'components/molecules/CheckList/CheckList.vue'
    ];

    it.each(sites)('%s parses the reply with parseGeneratedList', (site) => {
        const source = fs.readFileSync(path.resolve(__dirname, '../../src', site), 'utf8');
        expect(source.match(/\beval\s*\(/g)).toBeNull();
        expect(source.includes('parseGeneratedList(')).toBe(true);
    });
});
