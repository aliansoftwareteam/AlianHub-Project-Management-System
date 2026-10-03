import { afterEach, describe, expect, it, vi } from 'vitest';
import { readWorkingState, writeWorkingState } from '@/views/Everything/everythingSettings';

const KEY = 'ah.everything.c1.u1';

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('readWorkingState', () => {
    it('answers null when nothing was left behind', () => {
        expect(readWorkingState('c1', 'u1')).toBeNull();
    });

    it('brings back the settings and the saved view they came from', () => {
        writeWorkingState('c1', 'u1', { mode: 'board', group: 'status', status: ['open'] }, 'view-7');
        const state = readWorkingState('c1', 'u1');
        expect(state.viewId).toBe('view-7');
        expect(state.settings.mode).toBe('board');
        expect(state.settings.group).toBe('status');
        expect(state.settings.status).toEqual(['open']);
    });

    it('keeps each person in each workspace apart', () => {
        writeWorkingState('c1', 'u1', { mode: 'table' });
        writeWorkingState('c1', 'u2', { mode: 'board' });
        writeWorkingState('c2', 'u1', { mode: 'list' });
        expect(readWorkingState('c1', 'u1').settings.mode).toBe('table');
        expect(readWorkingState('c1', 'u2').settings.mode).toBe('board');
        expect(readWorkingState('c2', 'u1').settings.mode).toBe('list');
    });

    it('does not keep the search', () => {
        writeWorkingState('c1', 'u1', { search: 'invoice' });
        expect(readWorkingState('c1', 'u1').settings.search).toBe('');
        expect(JSON.parse(localStorage.getItem(KEY)).search).toBe('');
    });

    it('falls back to defaults for values an older build or a hand edit left behind', () => {
        localStorage.setItem(KEY, JSON.stringify({ mode: 'gantt', group: 'colour', sortBy: 'nonsense', due: 'someday', hideDone: 'yes', status: 'open' }));
        const { settings } = readWorkingState('c1', 'u1');
        expect(settings.mode).toBe('list');
        expect(settings.group).toBe('none');
        expect(settings.sortBy).toBe('updatedAt');
        expect(settings.due).toBe('');
        expect(settings.hideDone).toBe(true);
        expect(settings.status).toEqual([]);
    });

    it('uses the natural direction of the sort when the stored one is not asc or desc', () => {
        localStorage.setItem(KEY, JSON.stringify({ sortBy: 'DueDate', sortDir: 'sideways' }));
        expect(readWorkingState('c1', 'u1').settings.sortDir).toBe('asc');
    });

    it('answers an empty view id when the stored one is not text', () => {
        localStorage.setItem(KEY, JSON.stringify({ viewId: 12 }));
        expect(readWorkingState('c1', 'u1').viewId).toBe('');
    });

    it('answers null for text that is not JSON', () => {
        localStorage.setItem(KEY, '{broken');
        expect(readWorkingState('c1', 'u1')).toBeNull();
    });

    it('treats a stored JSON null, array or number as the defaults', () => {
        for (const raw of ['null', '[1,2]', '5']) {
            localStorage.setItem(KEY, raw);
            const state = readWorkingState('c1', 'u1');
            expect(state.settings.mode).toBe('list');
            expect(state.viewId).toBe('');
        }
    });

    it('answers null when the browser refuses access to storage', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        expect(readWorkingState('c1', 'u1')).toBeNull();
    });
});

describe('writeWorkingState', () => {
    it('stores a view id of empty text by default', () => {
        writeWorkingState('c1', 'u1', { mode: 'board' });
        expect(JSON.parse(localStorage.getItem(KEY)).viewId).toBe('');
    });

    it('stores only what the server would accept', () => {
        writeWorkingState('c1', 'u1', { mode: 'board', evil: '<script>', status: ['a', '', 3] });
        const stored = JSON.parse(localStorage.getItem(KEY));
        expect(stored.evil).toBeUndefined();
        expect(stored.status).toEqual(['a']);
    });

    it('does not throw when the store is full or private', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
        expect(() => writeWorkingState('c1', 'u1', { mode: 'board' })).not.toThrow();
    });
});
