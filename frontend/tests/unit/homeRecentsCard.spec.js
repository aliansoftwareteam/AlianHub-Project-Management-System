import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', props: ['name'], render: () => null } }));

import RecentsCard from '@/components/molecules/Home/RecentsCard.vue';
import { recentRoute, toRecentItem } from '@/components/molecules/Home/recentItems';

const TASK = { _id: 't1', TaskName: 'Fix login', TaskKey: 'AH-12', ProjectID: 'p1', sprintId: 's1', folderObjId: '' };
const blank = { render: () => null };

describe('toRecentItem', () => {
    it('reads today\'s task-only shape as a task', () => {
        expect(toRecentItem({ visitedAt: '2026-09-30T08:00:00Z', task: TASK })).toMatchObject({
            type: 'task', id: 't1', title: 'Fix login', code: 'AH-12', visitedAt: '2026-09-30T08:00:00Z', task: TASK,
        });
    });

    it('falls back to a task when a typed item has no type', () => {
        expect(toRecentItem({ entityType: undefined, task: TASK }).type).toBe('task');
    });

    it.each([
        ['project', { type: 'project', project: { _id: 'p1', ProjectName: 'Website' } }, { id: 'p1', title: 'Website' }],
        ['doc', { type: 'doc', doc: { _id: 'd1', title: 'Runbook' } }, { id: 'd1', title: 'Runbook' }],
        ['sprint', { type: 'sprint', sprint: { _id: 's1', name: 'Sprint 4', projectId: 'p1' } }, { id: 's1', title: 'Sprint 4', projectId: 'p1' }],
        ['project named in entityType with the item under item', { entityType: 'project', item: { id: 'p2', name: 'Ops' } }, { id: 'p2', title: 'Ops' }],
    ])('reads a %s', (_name, visit, expected) => {
        expect(toRecentItem(visit)).toMatchObject({ type: visit.type || visit.entityType, ...expected });
    });

    it.each([
        ['nothing', null],
        ['a task that is gone', { task: null }],
        ['a type this card cannot open', { type: 'whiteboard', whiteboard: { _id: 'w1', name: 'Board' } }],
        ['an item without an id', { type: 'project', project: { ProjectName: 'No id' } }],
    ])('skips %s', (_name, visit) => {
        expect(toRecentItem(visit)).toBeNull();
    });
});

describe('recentRoute', () => {
    it('opens a project, a sprint in or out of a folder, and a doc', () => {
        expect(recentRoute({ type: 'project', id: 'p1' }, 'c1')).toEqual({ name: 'Project', params: { cid: 'c1', id: 'p1' } });
        expect(recentRoute({ type: 'sprint', id: 's1', projectId: 'p1', folderId: '' }, 'c1')).toEqual({ name: 'ProjectSprint', params: { cid: 'c1', id: 'p1', sprintId: 's1' } });
        expect(recentRoute({ type: 'sprint', id: 's1', projectId: 'p1', folderId: 'f1' }, 'c1')).toEqual({ name: 'ProjectFolderSprint', params: { cid: 'c1', id: 'p1', folderId: 'f1', sprintId: 's1' } });
        expect(recentRoute({ type: 'doc', id: 'd1' }, 'c1')).toEqual({ name: 'PageEditor', params: { cid: 'c1', pageId: 'd1' } });
    });

    it('has no route for a sprint without its project', () => {
        expect(recentRoute({ type: 'sprint', id: 's1', projectId: '' }, 'c1')).toBeNull();
    });
});

describe('RecentsCard', () => {
    let router;
    const mountCard = async () => {
        router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/:cid', name: 'Home', component: blank },
                { path: '/:cid/project/:id', name: 'Project', component: blank },
            ],
        });
        await router.push('/company-1');
        await router.isReady();
        const wrapper = mount(RecentsCard, { global: { plugins: [router] } });
        await flushPromises();
        return wrapper;
    };

    beforeEach(() => {
        apiRequest.mockReset();
    });

    it('lists the recently opened items from the recent visits endpoint', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [
            { visitedAt: '2026-09-30T08:00:00Z', task: TASK },
            { type: 'project', visitedAt: '2026-09-30T07:00:00Z', project: { _id: 'p1', ProjectName: 'Website' } },
            { type: 'whiteboard', whiteboard: { _id: 'w1' } },
        ] } });
        const wrapper = await mountCard();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/recent-visits');
        const rows = wrapper.findAll('[data-test="recent-row"]');
        expect(rows.map((r) => r.text())).toEqual([expect.stringContaining('Fix login'), expect.stringContaining('Website')]);
        expect(wrapper.find('section').attributes('aria-label')).toBe('Home.card_recents');
    });

    it('opens a task in the task panel and a project by its route', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [
            { visitedAt: '2026-09-30T08:00:00Z', task: TASK },
            { type: 'project', project: { _id: 'p1', ProjectName: 'Website' } },
        ] } });
        const wrapper = await mountCard();
        const rows = wrapper.findAll('[data-test="recent-row"]');
        await rows[0].trigger('click');
        expect(wrapper.emitted('open')[0][0]).toEqual(TASK);
        await rows[1].trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe('/company-1/project/p1');
    });

    it('says so when nothing was opened yet', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [] } });
        const wrapper = await mountCard();
        expect(wrapper.find('[data-test="recents-empty"]').text()).toBe('Home.recents_empty');
    });

    it('says so when the list could not be read', async () => {
        apiRequest.mockRejectedValue(new Error('down'));
        const wrapper = await mountCard();
        expect(wrapper.find('[data-test="recents-failed"]').exists()).toBe(true);
    });

    it('can be removed from Home', async () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [] } });
        const wrapper = await mountCard();
        const hide = wrapper.find('[data-test="recents-hide"]');
        expect(hide.attributes('aria-label')).toBe('Home.hide_card');
        await hide.trigger('click');
        expect(wrapper.emitted('hide')).toHaveLength(1);
    });
});
