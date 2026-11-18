import { describe, expect, it } from 'vitest';
import {
    MAX_DEPTH,
    canAddSubtask,
    canBeParentOf,
    deepestParentDepth,
    depthOf,
    parentCandidateMatch,
    subtreeHeight,
    treeRefusalReason
} from '@/views/Projects/composables/taskDepth';

const root = { _id: 'r', isParentTask: true };
const child = { _id: 'c', isParentTask: false, ParentTaskId: 'r', ancestors: ['r'] };
const grandchild = { _id: 'g', isParentTask: false, ParentTaskId: 'c', ancestors: ['r', 'c'] };

describe('depth of a task', () => {
    it('counts the stored chain, and three levels is the limit', () => {
        expect(MAX_DEPTH).toBe(2);
        expect([root, child, grandchild].map(depthOf)).toEqual([0, 1, 2]);
    });

    it('reads a subtask written before the chain existed as one level down', () => {
        expect(depthOf({ _id: 'old', isParentTask: false, ParentTaskId: 'r' })).toBe(1);
    });

    it('reads a task with no parent as top-level even when a stale chain is still on it', () => {
        expect(depthOf({ _id: 'promoted', isParentTask: true, ParentTaskId: '', ancestors: ['r'] })).toBe(0);
    });

    it('lets a task and a subtask take a subtask, and a third-level one not', () => {
        expect([root, child, grandchild].map(canAddSubtask)).toEqual([true, true, false]);
        expect(canAddSubtask({})).toBe(true);
    });
});

describe('the height a moved task brings with it', () => {
    it('is the deepest descendant below it', () => {
        expect(subtreeHeight(root, [])).toBe(0);
        expect(subtreeHeight(root, [child])).toBe(1);
        expect(subtreeHeight(root, [child, grandchild])).toBe(2);
        expect(subtreeHeight(child, [grandchild])).toBe(1);
    });

    it('decides how deep a parent may sit', () => {
        expect([0, 1, 2].map(deepestParentDepth)).toEqual([1, 0, -1]);
    });
});

describe('who may become the parent of a task', () => {
    const moved = { _id: 'm', isParentTask: true };
    const ownChild = { _id: 'mc', isParentTask: false, ParentTaskId: 'm', ancestors: ['m'] };
    const ownGrandchild = { _id: 'mg', isParentTask: false, ParentTaskId: 'mc', ancestors: ['m', 'mc'] };

    it('offers first and second level tasks to a task with no subtasks', () => {
        expect(canBeParentOf(root, moved, 0)).toBe(true);
        expect(canBeParentOf(child, moved, 0)).toBe(true);
        expect(canBeParentOf(grandchild, moved, 0)).toBe(false);
    });

    it('never offers the task itself or anything below it', () => {
        expect(canBeParentOf(moved, moved, 0)).toBe(false);
        expect(canBeParentOf(ownChild, moved, 0)).toBe(false);
        expect(canBeParentOf(ownGrandchild, moved, 0)).toBe(false);
        expect(canBeParentOf({ _id: 'old-child', isParentTask: false, ParentTaskId: 'm' }, moved, 0)).toBe(false);
    });

    it('offers only first level tasks to a task that brings subtasks', () => {
        expect(canBeParentOf(root, moved, 1)).toBe(true);
        expect(canBeParentOf(child, moved, 1)).toBe(false);
    });

    it('offers nothing to a task whose subtasks already go two levels down', () => {
        expect(canBeParentOf(root, moved, 2)).toBe(false);
    });

    it('leaves out a subtask whose depth is not known', () => {
        expect(canBeParentOf({ _id: 'old', isParentTask: false, ParentTaskId: 'r' }, moved, 0)).toBe(false);
    });

    it('asks the server for the same rows', () => {
        expect(parentCandidateMatch(moved, 0)).toEqual({
            $and: [{ $or: [{ isParentTask: true }, { ancestors: { $size: 1 } }] }, { ancestors: { $ne: 'm' } }]
        });
        expect(parentCandidateMatch(moved, 1)).toEqual({ $and: [{ $or: [{ isParentTask: true }] }, { ancestors: { $ne: 'm' } }] });
        expect(parentCandidateMatch(moved, 2)).toBeNull();
    });
});

describe('a refusal from the task tree rules', () => {
    const refused = (code, statusText, status = 400) => ({ status: false, error: { response: { status, data: { status: false, statusText, code } } } });

    it('hands back the reason the server gave', () => {
        expect(treeRefusalReason(refused('PARENT_AT_MAX_DEPTH', 'Subtasks nest three levels deep at most, and that parent is already on the third.')))
            .toBe('Subtasks nest three levels deep at most, and that parent is already on the third.');
        expect(treeRefusalReason(refused('PARENT_NOT_FOUND', 'The parent task was not found.', 404))).toBe('The parent task was not found.');
        expect(treeRefusalReason(refused('SUBTREE_TOO_DEEP', 'Too deep.'))).toBe('Too deep.');
    });

    it('reads a bare request error the same way', () => {
        expect(treeRefusalReason({ response: { data: { status: false, statusText: 'The parent task was not found.', code: 'PARENT_NOT_FOUND' } } })).toBe('The parent task was not found.');
    });

    it('stays empty for any other failure', () => {
        expect(treeRefusalReason(refused(undefined, 'data must be an object.'))).toBe('');
        expect(treeRefusalReason(refused('ATTACHMENT_KEY_NOT_OWN', 'Not yours.'))).toBe('');
        expect(treeRefusalReason(new Error('Network Error'))).toBe('');
        expect(treeRefusalReason(undefined)).toBe('');
    });
});
