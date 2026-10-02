import { describe, expect, it } from 'vitest';
import {
    relativeTime, toDateInput, initials, reviewChipClass, reviewLabelKey, headingsOf,
} from '@/components/molecules/Pages/docsFormat';

const t = (key, params = {}) => (params.n === undefined ? key : `${key}:${params.n}`);
const NOW = new Date(2025, 5, 15, 12, 0, 0).getTime();
const ago = (ms) => new Date(NOW - ms);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
    it('under a minute is "just now"', () => {
        expect(relativeTime(ago(0), t, NOW)).toBe('Docs.just_now');
        expect(relativeTime(ago(59 * 1000), t, NOW)).toBe('Docs.just_now');
    });

    it('counts minutes up to an hour, then hours up to a day', () => {
        expect(relativeTime(ago(MIN), t, NOW)).toBe('Docs.minutes_ago:1');
        expect(relativeTime(ago(59 * MIN), t, NOW)).toBe('Docs.minutes_ago:59');
        expect(relativeTime(ago(HOUR), t, NOW)).toBe('Docs.hours_ago:1');
        expect(relativeTime(ago(23 * HOUR), t, NOW)).toBe('Docs.hours_ago:23');
    });

    it('a day to two days ago is "yesterday", then days up to two weeks', () => {
        expect(relativeTime(ago(DAY), t, NOW)).toBe('Docs.yesterday');
        expect(relativeTime(ago(2 * DAY - 1), t, NOW)).toBe('Docs.yesterday');
        expect(relativeTime(ago(2 * DAY), t, NOW)).toBe('Docs.days_ago:2');
        expect(relativeTime(ago(13 * DAY), t, NOW)).toBe('Docs.days_ago:13');
    });

    it('two weeks or more shows a date instead of a count', () => {
        const out = relativeTime(ago(14 * DAY), t, NOW);
        expect(out).not.toMatch(/^Docs\./);
        expect(out).not.toBe('—');
    });

    it('a time in the future counts as just now rather than a negative number', () => {
        expect(relativeTime(new Date(NOW + 5 * DAY), t, NOW)).toBe('Docs.just_now');
    });

    it('a value that is not a date shows a dash', () => {
        expect(relativeTime('nonsense', t, NOW)).toBe('—');
    });

    it('accepts an ISO string as well as a Date', () => {
        expect(relativeTime(new Date(NOW - 5 * MIN).toISOString(), t, NOW)).toBe('Docs.minutes_ago:5');
    });
});

describe('toDateInput', () => {
    it('gives the yyyy-mm-dd a date field wants, padded', () => {
        expect(toDateInput(new Date(2025, 0, 5))).toBe('2025-01-05');
        expect(toDateInput(new Date(2025, 11, 31))).toBe('2025-12-31');
    });

    it('29 February keeps its day', () => {
        expect(toDateInput(new Date(2024, 1, 29))).toBe('2024-02-29');
    });

    it('empty, null and rubbish give an empty field', () => {
        expect(toDateInput('')).toBe('');
        expect(toDateInput(null)).toBe('');
        expect(toDateInput(undefined)).toBe('');
        expect(toDateInput('rubbish')).toBe('');
    });
});

describe('initials', () => {
    it('takes the first and last word of a name, in capitals', () => {
        expect(initials('asha rao')).toBe('AR');
        expect(initials('Mary Jane Watson')).toBe('MW');
    });

    it('one word gives one letter', () => {
        expect(initials('Prince')).toBe('P');
    });

    it('extra spaces are ignored', () => {
        expect(initials('   Asha    Rao  ')).toBe('AR');
    });

    it('no name gives a question mark', () => {
        expect(initials('')).toBe('?');
        expect(initials('   ')).toBe('?');
        expect(initials(null)).toBe('?');
        expect(initials(undefined)).toBe('?');
    });
});

describe('review state', () => {
    it('verified is green, due is a warning, stale is red, anything else has no colour', () => {
        expect(reviewChipClass('verified')).toBe('ah-chip--ok');
        expect(reviewChipClass('due')).toBe('ah-chip--warn');
        expect(reviewChipClass('stale')).toBe('ah-chip--danger');
        expect(reviewChipClass('whatever')).toBe('');
        expect(reviewChipClass(undefined)).toBe('');
    });

    it('each state has its own label and an unknown one reads "not reviewed"', () => {
        expect(reviewLabelKey('verified')).toBe('Docs.verified');
        expect(reviewLabelKey('due')).toBe('Docs.due_now');
        expect(reviewLabelKey('stale')).toBe('Docs.stale');
        expect(reviewLabelKey(null)).toBe('Docs.not_reviewed');
    });
});

describe('headingsOf', () => {
    it('lists the headers of a page with their level and plain text', () => {
        const data = {
            blocks: [
                { id: 'a', type: 'header', data: { text: 'Intro', level: 1 } },
                { id: 'b', type: 'paragraph', data: { text: 'body' } },
                { id: 'c', type: 'header', data: { text: 'A <b>bold</b> idea', level: 3 } },
            ],
        };
        expect(headingsOf(data)).toEqual([
            { id: 'a', level: 1, text: 'Intro' },
            { id: 'c', level: 3, text: 'A bold idea' },
        ]);
    });

    it('a heading with no level is level 2, and one with no text or only spaces is left out', () => {
        const data = { blocks: [{ type: 'header', data: { text: 'No level' } }, { type: 'header', data: { text: '   ' } }, { type: 'header', data: {} }] };
        expect(headingsOf(data)).toEqual([{ id: '', level: 2, text: 'No level' }]);
    });

    it('a page with no blocks, no data or broken blocks has no headings', () => {
        expect(headingsOf(undefined)).toEqual([]);
        expect(headingsOf({})).toEqual([]);
        expect(headingsOf({ blocks: [null, { type: 'header' }] })).toEqual([]);
    });
});
