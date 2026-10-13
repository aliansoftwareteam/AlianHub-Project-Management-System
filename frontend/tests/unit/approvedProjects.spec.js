import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { apiRequest, sendProposalDecision, route, commit } = vi.hoisted(() => ({ apiRequest: vi.fn(), sendProposalDecision: vi.fn(), route: { query: {} }, commit: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace: () => Promise.resolve(), push: () => Promise.resolve(), hasRoute: () => false }) }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters: {}, commit }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ changeText: (text) => text }),
    useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Ada', Time_Zone: 'UTC' }) }),
}));
vi.mock('@/composable/agentProposals', () => ({ sendProposalDecision }));
vi.mock('@/components/organisms/Header/helper', () => ({ useHelper: () => ({ openRoute: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ openPanel: vi.fn() }));

import Inbox from '@/views/Inbox/Inbox.vue';
import { dropProjects, showProjects } from '@/composable/approvedProjects';
import { madeProjectIds, trashedProjectIds } from '@/composable/approvedProjectIds';

const PROJECT = '64b000000000000000000001';
const MUTATION = 'projectData/mutateProjects';
const stored = { _id: PROJECT, ProjectName: 'Launch', ProjectCode: 'L', isPrivateSpace: true, AssigneeUserId: ['user-1'], sprintsObj: {}, sprintsfolders: {} };
const made = { action: 'project.create', ok: true, result: { projectId: PROJECT, name: 'Launch', code: 'L', made: 0, parts: [], notMade: [] } };
const trashed = { auditId: 'a1', ok: true, result: { projectId: PROJECT, name: 'Launch', trashed: true } };
const added = [MUTATION, [{ snap: null, privateSnap: false, op: 'added', data: { ...stored, id: PROJECT, isExpanded: false } }]];
const removed = [MUTATION, [{ op: 'removed', data: { _id: PROJECT } }]];

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const projectReads = () => apiRequest.mock.calls.filter(([method, url]) => method === 'get' && url === `/api/v1/project/${PROJECT}`);

beforeEach(() => {
    commit.mockReset();
    apiRequest.mockReset();
    sendProposalDecision.mockReset();
});

describe('what an approval and an undo say about projects', () => {
    it('names the projects an approval made, and none it failed to make', () => {
        expect(madeProjectIds({ applied: [made, { action: 'task.comment', ok: true, result: { projectId: 'other' } }, { ...made, ok: false, error: 'no' }] })).toEqual([PROJECT]);
        expect(madeProjectIds({ applied: [{ action: 'project.duplicate', ok: true, result: { projectId: 'copy', copiedFrom: PROJECT } }] })).toEqual(['copy']);
        expect(madeProjectIds({ applied: [] })).toEqual([]);
        expect(madeProjectIds(undefined)).toEqual([]);
    });

    it('names the projects an undo moved to the trash, and none that stayed', () => {
        expect(trashedProjectIds({ results: [trashed, { auditId: 'a2', ok: false, reason: 'holds a task' }, { auditId: 'a3', ok: true, result: { taskId: 't1' } }] })).toEqual([PROJECT]);
        expect(trashedProjectIds({})).toEqual([]);
    });
});

describe('putting an approved project in front of the approver', () => {
    it('reads the project the way any page does and adds it to the store as the Create project screen does', async () => {
        apiRequest.mockResolvedValue({ data: stored });
        await showProjects({ commit }, [PROJECT, PROJECT]);
        expect(projectReads()).toHaveLength(1);
        expect(commit.mock.calls).toEqual([added]);
    });

    it('adds nothing for a project the server will not hand over, or one already in the trash', async () => {
        apiRequest.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 403'), { response: { status: 403 } }));
        await showProjects({ commit }, [PROJECT]);
        apiRequest.mockResolvedValueOnce({ data: { ...stored, deletedStatusKey: 1 } });
        await showProjects({ commit }, [PROJECT]);
        expect(commit).not.toHaveBeenCalled();
    });

    it('asks for nothing when no project was made, and survives a page with no store', async () => {
        await showProjects({ commit }, []);
        await showProjects(undefined, [PROJECT]);
        dropProjects(undefined, [PROJECT]);
        expect(apiRequest).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
    });

    it('takes a trashed project out of the store', () => {
        dropProjects({ commit }, [PROJECT]);
        expect(commit.mock.calls).toEqual([removed]);
    });
});

describe('approving a new project in the Inbox', () => {
    const proposal = {
        sourceType: 'proposal', sourceId: 'p1', proposalId: 'p1', kind: 'proposal', agentName: 'Claude (MCP)', source: 'mcp', requestedBy: 'user-1',
        what: 'project.create', why: 'Asked for it.', gate: null, locked: false, editable: false, createdAt: '2026-10-02T09:00:00.000Z', unread: true,
        changes: [{ action: 'project.create', params: { name: 'Launch' }, label: 'project.create via MCP', reversible: true, preview: { kind: 'project', title: 'Launch', lines: [] } }],
    };
    let wrapper;
    let undone;

    const open = async () => {
        const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
        wrapper = mount(Inbox, { attachTo: document.body, global: { plugins: [i18n], stubs: { UserProfile: true, ShellIcon: true } } });
        await flushPromises();
    };
    const approve = async () => {
        await wrapper.find('[data-test="queue-row"][data-id="p1"] [data-test="queue-approve"]').trigger('click');
        await flushPromises();
    };

    beforeEach(() => {
        route.query = {};
        undone = { results: [trashed] };
        sendProposalDecision.mockImplementation((id, verb) => ok(verb === 'undo' ? undone : { applied: [made], undoUntil: '2026-10-02T09:15:00.000Z' }));
        apiRequest.mockImplementation((method, url) => {
            if (method === 'get' && url === `/api/v1/project/${PROJECT}`) return Promise.resolve({ data: stored });
            if (method === 'get' && url.endsWith('/counts')) return ok({ approval: 1, primary: 0, other: 0, later: 0 });
            if (method === 'get') return ok({ items: [], approvals: [], proposals: [proposal], hasMore: false, nextSkip: 0 });
            return ok({});
        });
    });
    afterEach(() => { wrapper?.unmount(); wrapper = null; });

    it('shows the project without a reload', async () => {
        await open();
        await approve();
        expect(sendProposalDecision).toHaveBeenCalledWith('p1', 'approve', {});
        expect(projectReads()).toHaveLength(1);
        expect(commit.mock.calls).toEqual([added]);
    });

    it('takes it away again when the Undo bar moves it to the trash', async () => {
        await open();
        await approve();
        await wrapper.find('.ibx__undo-btn').trigger('click');
        await flushPromises();
        expect(sendProposalDecision).toHaveBeenLastCalledWith('p1', 'undo', {});
        expect(commit.mock.calls).toEqual([added, removed]);
    });

    it('leaves it in place when the undo could not trash it', async () => {
        undone = { results: [{ auditId: 'a1', ok: false, message: 'the project "Launch" holds a task now, so it stays' }] };
        await open();
        await approve();
        await wrapper.find('.ibx__undo-btn').trigger('click');
        await flushPromises();
        expect(commit.mock.calls).toEqual([added]);
    });

    it('reads no project after an approval that made none', async () => {
        sendProposalDecision.mockImplementation(() => ok({ applied: [{ action: 'task.comment', ok: true, result: {} }], undoUntil: '2026-10-02T09:15:00.000Z' }));
        await open();
        await approve();
        expect(projectReads()).toHaveLength(0);
        expect(commit).not.toHaveBeenCalled();
    });
});
