import { describe, expect, it, vi } from 'vitest';

vi.mock('@/composable/index.js', () => ({ useCustomComposable: () => ({ checkPermission: () => 0 }) }));

import { mutateProjects } from '@/store/ProjectData/mutations';

const modified = (data) => [{ snap: null, privateSnap: false, userId: 'user-1', roleType: 3, op: 'modified', data }];
const privateProject = () => ({ _id: 'p-private', isPrivateSpace: true, AssigneeUserId: ['owner-1'], sprintsObj: {}, sprintsfolders: {} });

describe('projectData/mutateProjects with a project the store does not hold (U5-27)', () => {
    it('does not throw while the project list has not loaded yet', () => {
        const state = { allProjects: [] };
        expect(() => mutateProjects(state, modified(privateProject()))).not.toThrow();
        expect(state.allProjects).toEqual([]);
    });

    it('does not throw on an empty project list', () => {
        const state = { allProjects: { data: [] } };
        expect(() => mutateProjects(state, modified(privateProject()))).not.toThrow();
        expect(state.allProjects).toEqual({ data: [] });
    });

    it('leaves the list unchanged when the modified project is not in it', () => {
        const other = { _id: 'p-other', AssigneeUserId: ['user-1'], sprintsObj: {}, sprintsfolders: {} };
        const state = { allProjects: { data: [other] } };
        expect(() => mutateProjects(state, modified(privateProject()))).not.toThrow();
        expect(state.allProjects).toEqual({ data: [{ _id: 'p-other', AssigneeUserId: ['user-1'], sprintsObj: {}, sprintsfolders: {} }] });
    });

    it('does not throw removing a project before the list has loaded', () => {
        const state = { allProjects: [] };
        expect(() => mutateProjects(state, [{ op: 'removed', data: { _id: 'p1' } }])).not.toThrow();
        expect(state.allProjects).toEqual([]);
    });

    it('still applies a modification to a project the list holds', () => {
        const held = { _id: 'p1', ProjectName: 'Old', AssigneeUserId: ['user-1'], sprintsObj: {}, sprintsfolders: {} };
        const state = { allProjects: { data: [held] } };
        mutateProjects(state, modified({ _id: 'p1', ProjectName: 'New', AssigneeUserId: ['user-1'], sprintsObj: {} }));
        expect(state.allProjects.data).toHaveLength(1);
        expect(state.allProjects.data[0].ProjectName).toBe('New');
    });
});
