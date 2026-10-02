import { describe, expect, it } from 'vitest';
import {
    TASK_NAME_MIN, TASK_NAME_MAX, firstLine, deriveTaskName, canConvertToTask,
} from '@/utils/notepadConvert';

describe('firstLine', () => {
    it('is the first line that has something on it, trimmed', () => {
        expect(firstLine('\n  \n   Buy milk  \nsecond')).toBe('Buy milk');
    });

    it('reads Windows line endings too', () => {
        expect(firstLine('Plan\r\nmore')).toBe('Plan');
        expect(firstLine('\r\n\r\nPlan')).toBe('Plan');
    });

    it('a note of only blanks, an empty one, and values that are not text give nothing', () => {
        expect(firstLine('  \n \t ')).toBe('');
        expect(firstLine('')).toBe('');
        expect(firstLine(null)).toBe('');
        expect(firstLine(undefined)).toBe('');
        expect(firstLine(42)).toBe('');
    });
});

describe('deriveTaskName', () => {
    it('prefers the title', () => {
        expect(deriveTaskName({ title: '  Weekly report ', content: 'something else' })).toBe('Weekly report');
    });

    it('with no title uses the first line of the content', () => {
        expect(deriveTaskName({ title: '   ', content: '\nCall the bank\nbring ID' })).toBe('Call the bank');
        expect(deriveTaskName({ content: 'Call the bank' })).toBe('Call the bank');
    });

    it('is cut to the longest a task name may be', () => {
        expect(deriveTaskName({ title: 'x'.repeat(400) })).toHaveLength(TASK_NAME_MAX);
        expect(deriveTaskName({ content: 'y'.repeat(400) })).toHaveLength(TASK_NAME_MAX);
    });

    it('a title that is not text is ignored', () => {
        expect(deriveTaskName({ title: 12, content: 'Fallback' })).toBe('Fallback');
    });

    it('no note, an empty note or an empty object give an empty name', () => {
        expect(deriveTaskName(null)).toBe('');
        expect(deriveTaskName(undefined)).toBe('');
        expect(deriveTaskName({})).toBe('');
    });
});

describe('canConvertToTask', () => {
    it('a note whose name has the shortest allowed length can be converted', () => {
        expect(canConvertToTask({ title: 'a'.repeat(TASK_NAME_MIN) })).toBe(true);
        expect(canConvertToTask({ title: 'a'.repeat(TASK_NAME_MIN - 1) })).toBe(false);
    });

    it('a very long note can, because its name is cut', () => {
        expect(canConvertToTask({ content: 'z'.repeat(5000) })).toBe(true);
    });

    it('an empty note cannot', () => {
        expect(canConvertToTask({})).toBe(false);
        expect(canConvertToTask(null)).toBe(false);
        expect(canConvertToTask({ content: '  \n  ' })).toBe(false);
    });

    it('the limits are 3 and 250', () => {
        expect([TASK_NAME_MIN, TASK_NAME_MAX]).toEqual([3, 250]);
    });
});
