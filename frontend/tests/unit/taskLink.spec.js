import { describe, expect, it, vi } from 'vitest';
import { taskUrl } from '@/views/Projects/composables/taskLink';

const routerReturning = (href) => ({ resolve: vi.fn(() => ({ href })) });

describe('taskUrl', () => {
    it('resolves a task in a list through the sprint route and makes the address absolute', () => {
        const router = routerReturning('/c1/p1/s1/t1');
        const url = taskUrl(router, { companyId: 'c1', project: { _id: 'p1' }, task: { _id: 't1', sprintId: 's1' } });
        expect(router.resolve).toHaveBeenCalledWith({ name: 'ProjectSprintTask', params: { cid: 'c1', id: 'p1', sprintId: 's1', taskId: 't1' } });
        expect(url).toBe(new URL('/c1/p1/s1/t1', window.location.href).toString());
    });

    it('uses the folder route and names the folder when the task sits in one', () => {
        const router = routerReturning('/f');
        taskUrl(router, { companyId: 'c1', project: { _id: 'p1' }, task: { _id: 't1', sprintId: 's1', folderObjId: 'f1' } });
        expect(router.resolve).toHaveBeenCalledWith({
            name: 'ProjectFolderSprintTask',
            params: { cid: 'c1', id: 'p1', sprintId: 's1', taskId: 't1', folderId: 'f1' },
        });
    });

    it('takes the company from the project when none is given', () => {
        const router = routerReturning('/x');
        taskUrl(router, { project: { _id: 'p1', CompanyId: 'from-project' }, task: { _id: 't1', sprintId: 's1' } });
        expect(router.resolve.mock.calls[0][0].params.cid).toBe('from-project');
    });

    it('prefers the explicit company over the project one', () => {
        const router = routerReturning('/x');
        taskUrl(router, { companyId: 'given', project: { _id: 'p1', CompanyId: 'other' }, task: { _id: 't1' } });
        expect(router.resolve.mock.calls[0][0].params.cid).toBe('given');
    });

    it('keeps an already absolute address as it is', () => {
        const router = routerReturning('https://hub.example.com/c/p/s/t');
        expect(taskUrl(router, { companyId: 'c', project: { _id: 'p' }, task: { _id: 't' } })).toBe('https://hub.example.com/c/p/s/t');
    });

    it('answers an empty string when the router cannot resolve the route', () => {
        const router = { resolve: () => { throw new Error('No match'); } };
        expect(taskUrl(router, { companyId: 'c', project: { _id: 'p' }, task: { _id: 't' } })).toBe('');
    });

    it('leaves the project id out when there is no project', () => {
        const router = routerReturning('/ok');
        const url = taskUrl(router, { companyId: 'c', task: { _id: 't' } });
        expect(router.resolve.mock.calls[0][0].params.id).toBeUndefined();
        expect(url).toBe(new URL('/ok', window.location.href).toString());
    });
});
