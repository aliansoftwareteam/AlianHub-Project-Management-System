import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, stored } = vi.hoisted(() => ({ apiRequest: vi.fn(), stored: { items: [] } }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));

import * as env from '@/config/env';
import FavouriteStar from '@/components/atom/FavouriteStar/FavouriteStar.vue';
import { favouritesState, isFavourite, resetFavourites, favouriteRoute, moveFavourite } from '@/composable/favourites';

/* The server as the store sees it: PUT answers with the caller's resolved list. */
const serve = () => apiRequest.mockImplementation((method, url, body) => {
    if (method === 'get') return Promise.resolve({ data: { status: true, data: stored.items } });
    if (url === env.USER_FAVOURITES) {
        stored.items = body.favourite
            ? [...stored.items.filter((f) => !(f.type === body.type && f.id === body.id)), { type: body.type, id: body.id, name: `${body.type} name` }]
            : stored.items.filter((f) => !(f.type === body.type && f.id === body.id));
    } else if (url === `${env.USER_FAVOURITES}/order`) {
        stored.items = body.keys.map((key) => stored.items.find((f) => `${f.type}:${f.id}` === key));
    }
    return Promise.resolve({ data: { status: true, data: stored.items } });
});

const star = (props) => mount(FavouriteStar, { props });

beforeEach(() => {
    stored.items = [];
    resetFavourites();
    serve();
});

describe('one favourites store behind every star', () => {
    it('stars a project, a folder, a sprint, a task and a doc into the same list', async () => {
        const stars = [
            star({ type: 'project', id: 'p1', name: 'Alpha' }),
            star({ type: 'folder', id: 'f1', name: 'Design', projectId: 'p1' }),
            star({ type: 'sprint', id: 's1', name: 'Sprint 1', projectId: 'p1' }),
            star({ type: 'task', id: 't1', name: 'Fix it', projectId: 'p1', sprintId: 's1' }),
            star({ type: 'doc', id: 'd1', name: 'Handbook' })
        ];
        for (const wrapper of stars) {
            await wrapper.find('button').trigger('click');
            await flushPromises();
        }

        const puts = apiRequest.mock.calls.filter(([method]) => method === 'put');
        expect(puts.map(([, url]) => url)).toEqual(Array(5).fill(env.USER_FAVOURITES));
        expect(puts.map(([, , body]) => `${body.type}:${body.id}:${body.favourite}`)).toEqual(['project:p1:true', 'folder:f1:true', 'sprint:s1:true', 'task:t1:true', 'doc:d1:true']);
        expect(favouritesState.items.map((f) => f.type)).toEqual(['project', 'folder', 'sprint', 'task', 'doc']);
        stars.forEach((wrapper) => expect(wrapper.find('button').attributes('aria-pressed')).toBe('true'));
    });

    it('shows one state on every star of the same item and unstars it everywhere', async () => {
        const header = star({ type: 'sprint', id: 's1', name: 'Sprint 1' });
        const tree = star({ type: 'sprint', id: 's1', name: 'Sprint 1' });
        await header.find('button').trigger('click');
        await flushPromises();
        expect(tree.find('button').attributes('aria-pressed')).toBe('true');

        await tree.find('button').trigger('click');
        await flushPromises();
        expect(isFavourite('sprint', 's1')).toBe(false);
        expect(header.find('button').attributes('aria-pressed')).toBe('false');
        expect(apiRequest.mock.calls.filter(([m]) => m === 'put').pop()[2]).toEqual({ type: 'sprint', id: 's1', favourite: false });
    });

    it('turns the star on before the server answers and back off when it refuses', async () => {
        let refuse;
        apiRequest.mockImplementationOnce(() => new Promise((resolve, reject) => { refuse = reject; }));
        const wrapper = star({ type: 'task', id: 't9', name: 'Pending' });
        await wrapper.find('button').trigger('click');
        expect(wrapper.find('button').attributes('aria-pressed')).toBe('true');
        refuse(new Error('offline'));
        await flushPromises();
        expect(wrapper.find('button').attributes('aria-pressed')).toBe('false');
    });

    it('has a name for assistive tech', () => {
        const wrapper = star({ type: 'project', id: 'p1', name: 'Alpha' });
        const button = wrapper.find('button');
        expect(button.attributes('type')).toBe('button');
        expect(button.attributes('aria-label')).toBeTruthy();
    });

    it('saves a new order as the list of keys', async () => {
        stored.items = [{ type: 'project', id: 'p1', name: 'Alpha' }, { type: 'task', id: 't1', name: 'Fix it' }];
        favouritesState.items = [...stored.items];
        moveFavourite(1, 0);
        await flushPromises();
        expect(favouritesState.items.map((f) => f.id)).toEqual(['t1', 'p1']);
        expect(apiRequest).toHaveBeenCalledWith('put', `${env.USER_FAVOURITES}/order`, { keys: ['task:t1', 'project:p1'] });
    });
});

describe('favourite links', () => {
    it('open each kind of item where it lives', () => {
        expect(favouriteRoute({ type: 'project', id: 'p1' }, 'c1')).toEqual({ name: 'Project', params: { cid: 'c1', id: 'p1' } });
        expect(favouriteRoute({ type: 'folder', id: 'f1', projectId: 'p1' }, 'c1')).toEqual({ name: 'ProjectFolder', params: { cid: 'c1', id: 'p1', folderId: 'f1' } });
        expect(favouriteRoute({ type: 'sprint', id: 's1', projectId: 'p1' }, 'c1')).toEqual({ name: 'ProjectSprint', params: { cid: 'c1', id: 'p1', sprintId: 's1' } });
        expect(favouriteRoute({ type: 'sprint', id: 's1', projectId: 'p1', folderId: 'f1' }, 'c1')).toEqual({ name: 'ProjectFolderSprint', params: { cid: 'c1', id: 'p1', folderId: 'f1', sprintId: 's1' } });
        expect(favouriteRoute({ type: 'task', id: 't1', projectId: 'p1', sprintId: 's1' }, 'c1')).toEqual({ name: 'ProjectSprintTask', params: { cid: 'c1', id: 'p1', sprintId: 's1', taskId: 't1' } });
        expect(favouriteRoute({ type: 'doc', id: 'd1' }, 'c1')).toEqual({ name: 'PageEditor', params: { cid: 'c1', pageId: 'd1' } });
    });
});
