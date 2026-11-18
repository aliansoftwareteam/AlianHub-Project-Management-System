import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { api } = vi.hoisted(() => ({ api: { propose: null, create: null, undo: null } }));

vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url) => {
        if (String(url).endsWith('/propose')) return Promise.resolve({ data: api.propose });
        if (String(url).endsWith('/undo')) return Promise.resolve({ data: api.undo });
        return Promise.resolve({ data: api.create });
    })
}));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import { apiRequest } from '@/services';
import AiTaskChecklist from '@/components/molecules/AiPreview/AiTaskChecklist.vue';

const PROPOSAL = {
    items: [
        { key: 'a', title: 'Send the deck', ownerId: 'u-bob', due: '2026-10-02', dueText: '2026-10-02' },
        { key: 'b', title: 'Book the venue', ownerId: '', due: '', dueText: '' },
        { key: 'c', title: 'Write the recap', ownerId: '', due: '', dueText: 'soon' }
    ],
    people: [{ id: 'u-bob', name: 'Bob Stone', projectIds: ['p-1'] }, { id: 'u-ann', name: 'Ann Lee', projectIds: ['p-2'] }],
    projects: [{ id: 'p-1', name: 'Launch' }, { id: 'p-2', name: 'Ops' }],
    projectId: 'p-1',
    fixedProject: false
};

const posts = (suffix) => apiRequest.mock.calls.filter(([method, url]) => method === 'post' && String(url).endsWith(suffix));

function mountChecklist(props = {}) {
    return mount(AiTaskChecklist, {
        attachTo: document.body.appendChild(document.createElement('div')),
        props: { kind: 'call', sourceId: 'notes-1', ...props },
        global: { stubs: { 'router-link': { template: '<a><slot /></a>' } } }
    });
}

beforeEach(() => {
    apiRequest.mockClear();
    api.propose = { status: true, data: JSON.parse(JSON.stringify(PROPOSAL)) };
    api.create = { status: true, data: { created: [{ key: 'a', taskId: 't-1', title: 'Send the deck', projectId: 'p-1' }, { key: 'c', taskId: 't-3', title: 'Write the recap', projectId: 'p-1' }], dropped: [] } };
    api.undo = { status: true, data: { removed: ['t-1', 't-3'] } };
});
afterEach(() => { document.body.innerHTML = ''; });

describe('notes to tasks preview', () => {
    it('asks for a proposal from the source and lists every item ticked', async () => {
        const wrapper = mountChecklist();
        await flushPromises();

        expect(posts('/propose')[0][2]).toEqual({ kind: 'call', id: 'notes-1' });
        const rows = wrapper.findAll('.atc__row');
        expect(rows).toHaveLength(3);
        expect(rows.every((row) => row.get('.atc__tick').element.checked)).toBe(true);
        expect(wrapper.find('.atc__done').exists()).toBe(false);
        expect(posts('/notes-to-tasks')).toHaveLength(0);
    });

    it('creates only the ticked items, with the edits made in the preview', async () => {
        const wrapper = mountChecklist();
        await flushPromises();
        const rows = wrapper.findAll('.atc__row');
        await rows[1].get('.atc__tick').setValue(false);
        await rows[2].get('.atc__title').setValue('Write the launch recap');
        await rows[2].get('.atc__due').setValue('2026-10-09');

        await wrapper.get('.aip__replace').trigger('click');
        await flushPromises();

        const [[, , body]] = posts('/notes-to-tasks');
        expect(body).toEqual({
            kind: 'call',
            id: 'notes-1',
            projectId: 'p-1',
            items: [
                { key: 'a', title: 'Send the deck', ownerId: 'u-bob', due: '2026-10-02' },
                { key: 'c', title: 'Write the launch recap', ownerId: '', due: '2026-10-09' }
            ]
        });
        expect(wrapper.get('.atc__done').text()).toContain('NotesToTasks.created');
        expect(wrapper.emitted('created')[0][0]).toHaveLength(2);
    });

    it('does not create anything when nothing is ticked', async () => {
        const wrapper = mountChecklist();
        await flushPromises();
        for (const row of wrapper.findAll('.atc__row')) await row.get('.atc__tick').setValue(false);

        expect(wrapper.get('.aip__replace').attributes('disabled')).toBeDefined();
        await wrapper.get('.aip__replace').trigger('click');
        await flushPromises();
        expect(posts('/notes-to-tasks')).toHaveLength(0);
    });

    it('offers only owners who can open the chosen project', async () => {
        const wrapper = mountChecklist();
        await flushPromises();
        const owners = () => wrapper.findAll('.atc__row')[0].findAll('.atc__owner option').map((o) => o.element.value);
        expect(owners()).toEqual(['', 'u-bob']);

        await wrapper.get('.atc__project').setValue('p-2');
        expect(owners()).toEqual(['', 'u-ann']);
        expect(wrapper.findAll('.atc__row')[0].get('.atc__owner').element.value).toBe('');
    });

    it('keeps the page\'s project when the source fixes it', async () => {
        api.propose.data.fixedProject = true;
        const wrapper = mountChecklist({ kind: 'page', sourceId: 'page-1' });
        await flushPromises();

        expect(wrapper.get('.atc__project').attributes('disabled')).toBeDefined();
    });

    it('undoes the tasks it just created', async () => {
        const wrapper = mountChecklist();
        await flushPromises();
        await wrapper.get('.aip__replace').trigger('click');
        await flushPromises();

        await wrapper.get('.atc__undo').trigger('click');
        await flushPromises();

        expect(posts('/undo')[0][2]).toEqual({ kind: 'call', id: 'notes-1', taskIds: ['t-1', 't-3'] });
        expect(wrapper.emitted('undone')).toEqual([[['t-1', 't-3']]]);
        expect(wrapper.find('.atc__undo').exists()).toBe(false);
    });

    it('closes on Cancel without creating', async () => {
        const wrapper = mountChecklist();
        await flushPromises();
        await wrapper.get('.aip__cancel').trigger('click');

        expect(wrapper.emitted('close')).toHaveLength(1);
        expect(posts('/notes-to-tasks')).toHaveLength(0);
    });

    it('shows why when the proposal is refused', async () => {
        api.propose = { status: false, statusText: 'AI is turned off for this workspace.' };
        const wrapper = mountChecklist();
        await flushPromises();

        expect(wrapper.get('.atc__error').text()).toContain('AI is turned off for this workspace.');
        expect(wrapper.findAll('.atc__row')).toHaveLength(0);
    });
});
