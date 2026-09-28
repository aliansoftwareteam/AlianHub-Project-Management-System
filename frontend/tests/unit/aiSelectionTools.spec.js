import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { ops, api } = vi.hoisted(() => ({
    ops: {
        createSubTaskWithAi: vi.fn(() => Promise.resolve({ status: true, data: [{ _id: 'new-1', TaskName: 'Write the FAQ', ProjectID: 'proj-1', sprintId: 'list-2' }] })),
        updateArchiveDelete: vi.fn(() => Promise.resolve({ status: true }))
    },
    api: { replies: {} }
}));

vi.mock('@/utils/TaskOperations', () => ({ default: ops }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `Name ${id}` }) })
}));
vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url) => Promise.resolve(api.replies[url] || { data: { status: false } }))
}));

import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { dismissUndoToast, runUndo, undoToast } from '@/composable/useUndoToast';
import { createSelectionTools } from '@/components/molecules/AiSelection/selectionTools';
import AiSelectionPanel from '@/components/molecules/AiSelection/AiSelectionPanel.vue';
import en from '@/locales/en.js';

config.global.plugins[0].global.setLocaleMessage('en', en);
const t = config.global.plugins[0].global.t;
const ok = (data) => ({ data: { status: true, data } });

const PROJECT = { _id: 'proj-1', CompanyId: 'company-1', ProjectName: 'Growth', ProjectCode: 'GR', lastTaskId: 3, isGlobalPermission: false };
const LISTS = [{ id: 'list-1', name: 'Backlog' }, { id: 'list-2', name: 'Sprint 2', folderId: 'f1', folderName: 'Q4' }];

function paragraph(text) {
    const node = document.createElement('div');
    node.contentEditable = 'true';
    node.textContent = text;
    document.body.appendChild(node);
    return node;
}

function rangeOver(node, from, to) {
    const range = document.createRange();
    range.setStart(node.firstChild, from);
    range.setEnd(node.firstChild, to);
    return range;
}

const snapshot = { blocks: [{ type: 'paragraph', data: { text: 'Hello long world' } }] };
const editorStub = () => ({
    save: vi.fn(async () => snapshot),
    render: vi.fn(async () => {}),
    blocks: { insert: vi.fn() }
});

function mountPanel(props = {}) {
    const store = createStore({ getters: { 'settings/companyOwnerDetail': () => ({ userId: 'owner-1' }) } });
    return mount(AiSelectionPanel, {
        attachTo: document.body.appendChild(document.createElement('div')),
        props,
        global: { plugins: [store], mocks: { $t: t }, provide: { $userId: ref('u1'), $companyId: ref('company-1') } }
    });
}

beforeEach(() => {
    api.replies = {};
    Object.values(ops).forEach((fn) => fn.mockClear());
    apiRequest.mockClear();
});
afterEach(() => { dismissUndoToast(); document.body.innerHTML = ''; });

describe('the Editor.js selection tools', () => {
    it('are inline tools with translated titles that hand the selection over', () => {
        const onPick = vi.fn();
        const tools = createSelectionTools({ t, onPick, canSplit: true });
        const Improve = tools.aiImprove.class;
        const Tasks = tools.aiTasks.class;
        expect(Improve.isInline).toBe(true);
        expect(Improve.title).toBe(t('AiSelection.improve'));
        expect(Tasks.title).toBe(t('AiSelection.turn_into_tasks'));

        const api = { styles: { inlineToolButton: 'ce-inline-tool' }, blocks: { getCurrentBlockIndex: () => 2 }, inlineToolbar: { close: vi.fn() } };
        const tool = new Improve({ api, config: tools.aiImprove.config });
        const button = tool.render();
        expect(button.getAttribute('aria-label')).toBe(t('AiSelection.improve'));
        const node = paragraph('Hello long world');
        tool.surround(rangeOver(node, 6, 16));
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'improve', text: 'long world', blockIndex: 2 }));
        expect(api.inlineToolbar.close).toHaveBeenCalled();

        onPick.mockClear();
        tool.surround(rangeOver(node, 5, 6));
        expect(onPick).not.toHaveBeenCalled();
    });

    it('leave out Turn into tasks where there is nowhere to create them', () => {
        expect(createSelectionTools({ t, onPick: vi.fn(), canSplit: false }).aiTasks).toBeUndefined();
    });
});

describe('Improve with AI', () => {
    it('spends nothing until a mode is chosen, then previews the result', async () => {
        api.replies[env.AI_SELECTION_IMPROVE] = ok({ text: 'short' });
        const node = paragraph('Hello long world');
        const wrapper = mountPanel({ editor: editorStub });
        wrapper.vm.open({ kind: 'improve', text: 'long world', range: rangeOver(node, 6, 16), blockIndex: 0 });
        await flushPromises();
        expect(apiRequest).not.toHaveBeenCalled();
        expect(wrapper.findAll('[data-mode]').map((b) => b.attributes('data-mode'))).toEqual(['rewrite', 'shorten', 'expand', 'grammar', 'translate']);
        await wrapper.get('[data-mode="shorten"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', env.AI_SELECTION_IMPROVE, { mode: 'shorten', text: 'long world' });
        expect(wrapper.get('.aip__text').text()).toBe('short');
        expect(node.textContent).toBe('Hello long world');
    });

    it('replaces the selection on Replace and restores it on Undo', async () => {
        api.replies[env.AI_SELECTION_IMPROVE] = ok({ text: 'short' });
        const node = paragraph('Hello long world');
        const editor = editorStub();
        const wrapper = mountPanel({ editor: () => editor });
        wrapper.vm.open({ kind: 'improve', text: 'long world', range: rangeOver(node, 6, 16), blockIndex: 0 });
        await flushPromises();
        await wrapper.get('[data-mode="rewrite"]').trigger('click');
        await flushPromises();
        await wrapper.get('.aip__replace').trigger('click');
        await flushPromises();
        expect(node.textContent).toBe('Hello short');
        expect(wrapper.emitted('changed')).toHaveLength(1);
        expect(wrapper.find('.aip').exists()).toBe(false);
        expect(undoToast.current).not.toBeNull();
        await runUndo();
        expect(editor.render).toHaveBeenCalledWith(snapshot);
        expect(wrapper.emitted('changed')).toHaveLength(2);
    });

    it('inserts the result as a new block below on Insert below', async () => {
        api.replies[env.AI_SELECTION_IMPROVE] = ok({ text: 'An <b>expanded</b> line' });
        const node = paragraph('Hello long world');
        const editor = editorStub();
        const wrapper = mountPanel({ editor: () => editor });
        wrapper.vm.open({ kind: 'improve', text: 'long world', range: rangeOver(node, 6, 16), blockIndex: 3 });
        await flushPromises();
        await wrapper.get('[data-mode="expand"]').trigger('click');
        await flushPromises();
        expect(wrapper.get('.aip__insert').text()).toBe(t('AiSelection.insert_below'));
        await wrapper.get('.aip__insert').trigger('click');
        await flushPromises();
        expect(editor.blocks.insert).toHaveBeenCalledWith('paragraph', { text: 'An &lt;b&gt;expanded&lt;/b&gt; line' }, undefined, 4, true);
        expect(node.textContent).toBe('Hello long world');
    });

    it('asks for a language before translating', async () => {
        api.replies[env.AI_SELECTION_IMPROVE] = ok({ text: 'Hola' });
        const node = paragraph('Hello');
        const wrapper = mountPanel({ editor: editorStub });
        wrapper.vm.open({ kind: 'improve', text: 'Hello', range: rangeOver(node, 0, 5), blockIndex: 0 });
        await flushPromises();
        await wrapper.get('[data-mode="translate"]').trigger('click');
        expect(apiRequest).not.toHaveBeenCalled();
        await wrapper.get('[data-test="ai-language"]').setValue('Spanish');
        await wrapper.get('[data-test="ai-translate-form"]').trigger('submit');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', env.AI_SELECTION_IMPROVE, { mode: 'translate', text: 'Hello', language: 'Spanish' });
    });

    it('closes on Cancel without touching the text', async () => {
        const node = paragraph('Hello long world');
        const editor = editorStub();
        const wrapper = mountPanel({ editor: () => editor });
        wrapper.vm.open({ kind: 'improve', text: 'long world', range: rangeOver(node, 6, 16), blockIndex: 0 });
        await flushPromises();
        await wrapper.get('[data-test="ai-selection-cancel"]').trigger('click');
        expect(wrapper.find('[data-test="ai-selection"]').exists()).toBe(false);
        expect(editor.save).not.toHaveBeenCalled();
        expect(node.textContent).toBe('Hello long world');
    });
});

describe('Turn selection into tasks', () => {
    it('previews the titles as a checklist and creates the checked ones in the chosen list, with undo', async () => {
        api.replies[env.AI_SELECTION_TASKS] = ok({ titles: ['Write the FAQ', 'Book the review', 'Tell support'] });
        const wrapper = mountPanel({ editor: editorStub, target: { projectData: PROJECT, lists: LISTS } });
        wrapper.vm.open({ kind: 'tasks', text: 'We need an FAQ, a review and to tell support.' });
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', env.AI_SELECTION_TASKS, { text: 'We need an FAQ, a review and to tell support.' });
        expect(wrapper.findAll('[data-test="ai-task-title"]').map((row) => row.text())).toEqual(['Write the FAQ', 'Book the review', 'Tell support']);
        expect(ops.createSubTaskWithAi).not.toHaveBeenCalled();

        await wrapper.findAll('[data-test="ai-task-title"] input')[2].setValue(false);
        await wrapper.get('[data-test="ai-task-list"]').setValue('list-2');
        await wrapper.get('.aip__replace').trigger('click');
        await vi.waitFor(() => expect(ops.createSubTaskWithAi).toHaveBeenCalled());
        await flushPromises();
        expect(ops.createSubTaskWithAi).toHaveBeenCalledWith(expect.objectContaining({
            type: 'task',
            subTitles: [{ title: 'Write the FAQ' }, { title: 'Book the review' }],
            sprintObj: { id: 'list-2', name: 'Sprint 2', folderId: 'f1', folderName: 'Q4' },
            parentTask: { ProjectID: 'proj-1' },
            projectData: expect.objectContaining({ _id: 'proj-1', ProjectName: 'Growth' })
        }));
        await runUndo();
        expect(ops.updateArchiveDelete).toHaveBeenCalledWith(expect.objectContaining({ deletedStatusKey: 1, task: expect.objectContaining({ _id: 'new-1' }) }));
    });
});
