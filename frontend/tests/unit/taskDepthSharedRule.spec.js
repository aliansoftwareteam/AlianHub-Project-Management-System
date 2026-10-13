import { describe, expect, it, vi } from 'vitest';

vi.mock('@taskTreeRules', () => ({ MAX_DEPTH: 3 }));

import { MAX_DEPTH, canAddSubtask, deepestParentDepth } from '@/views/Projects/composables/taskDepth';

const thirdLevel = { _id: 'g', isParentTask: false, ParentTaskId: 'c', ancestors: ['r', 'c'] };
const fourthLevel = { _id: 'h', isParentTask: false, ParentTaskId: 'g', ancestors: ['r', 'c', 'g'] };

describe('the depth limit of the task panel and the parent picker', () => {
    it('is the one the server and the List read, not a copy of it', () => {
        expect(MAX_DEPTH).toBe(3);
        expect(canAddSubtask(thirdLevel)).toBe(true);
        expect(canAddSubtask(fourthLevel)).toBe(false);
        expect(deepestParentDepth()).toBe(2);
    });
});
