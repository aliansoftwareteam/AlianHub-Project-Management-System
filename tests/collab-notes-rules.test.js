/**
 * Personal Notepad Rules Test Suite (COLLAB-06)
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Notes/notesRules.js. Pure — no DB / socket / network.
 * Covers the note-to-task name derivation that seeds the EXISTING task-create
 * flow, the convert eligibility predicate, and payload sanitisation.
 */

const {
    TASK_NAME_MIN,
    TASK_NAME_MAX,
    firstLine,
    deriveTaskName,
    canConvertToTask,
    sanitizeNotePayload,
} = require('../Modules/Notes/notesRules');

describe('📝 PERSONAL NOTEPAD - Rules', () => {

    describe('firstLine', () => {
        test('returns the first non-empty trimmed line', () => {
            expect(firstLine('  hello \nworld')).toBe('hello');
        });
        test('skips leading blank lines', () => {
            expect(firstLine('\n\n  first real line\nsecond')).toBe('first real line');
        });
        test('handles junk / non-strings', () => {
            expect(firstLine(undefined)).toBe('');
            expect(firstLine('')).toBe('');
            expect(firstLine('   \n  ')).toBe('');
        });
    });

    describe('deriveTaskName', () => {
        test('prefers the title when present', () => {
            expect(deriveTaskName({ title: 'Call client', content: 'some body' })).toBe('Call client');
        });
        test('falls back to the first line of content when title is blank', () => {
            expect(deriveTaskName({ title: '   ', content: 'Fix the login bug\nmore detail' })).toBe('Fix the login bug');
        });
        test('clamps to the task-name max length', () => {
            const long = 'x'.repeat(TASK_NAME_MAX + 50);
            expect(deriveTaskName({ title: long }).length).toBe(TASK_NAME_MAX);
        });
        test('empty note yields empty name', () => {
            expect(deriveTaskName({})).toBe('');
            expect(deriveTaskName(undefined)).toBe('');
        });
    });

    describe('canConvertToTask', () => {
        test('a note with a usable title can convert', () => {
            expect(canConvertToTask({ title: 'Ship release' })).toBe(true);
        });
        test('a note with only content can convert', () => {
            expect(canConvertToTask({ content: 'Review the PR before EOD' })).toBe(true);
        });
        test('a too-short note cannot convert (min length)', () => {
            expect(canConvertToTask({ title: 'ok' })).toBe(false);
            expect(TASK_NAME_MIN).toBe(3);
        });
        test('an empty note cannot convert', () => {
            expect(canConvertToTask({})).toBe(false);
            expect(canConvertToTask({ title: '   ', content: '   ' })).toBe(false);
        });
    });

    describe('sanitizeNotePayload', () => {
        test('keeps only known fields', () => {
            const out = sanitizeNotePayload({ title: 'T', content: 'C', userId: 'hack', deletedStatusKey: 9 });
            expect(out).toEqual({ title: 'T', content: 'C' });
        });
        test('omits fields that were not sent (partial update)', () => {
            expect(sanitizeNotePayload({ content: 'only content' })).toEqual({ content: 'only content' });
            expect(sanitizeNotePayload({})).toEqual({});
        });
        test('coerces convertedTaskId to a string and blanks falsy', () => {
            expect(sanitizeNotePayload({ convertedTaskId: 123 }).convertedTaskId).toBe('123');
            expect(sanitizeNotePayload({ convertedTaskId: '' }).convertedTaskId).toBe('');
        });
    });
});
