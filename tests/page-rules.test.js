/**
 * Page Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Pages/helpers/pageRules.js. Pure — no DB.
 */

const {
    MAX_TITLE_LENGTH,
    REVIEW_INTERVAL_MONTHS,
    validatePageInput,
    contentTooLarge,
    htmlToRawText,
    parseDate,
    nextReviewDate,
    reviewState,
} = require('../Modules/Pages/helpers/pageRules');

const COMPANY = '64b7f0c2a1b2c3d4e5f60700';
const PROJECT = '64b7f0c2a1b2c3d4e5f60711';

describe('📄 PAGES - Rules', () => {

    describe('validatePageInput', () => {

        test('title only is enough; optional project validated', () => {
            expect(validatePageInput({ companyId: COMPANY, title: 'Handbook' }).valid).toBe(true);
            expect(validatePageInput({ companyId: COMPANY, title: 'Handbook', projectId: PROJECT }).valid).toBe(true);
            expect(validatePageInput({ companyId: COMPANY, title: 'Handbook', projectId: '' }).valid).toBe(true);
        });

        test('missing companyId, empty or oversized title, bad project fail', () => {
            expect(validatePageInput({ companyId: '', title: 'X' }).valid).toBe(false);
            expect(validatePageInput({ companyId: COMPANY, title: '  ' }).valid).toBe(false);
            expect(validatePageInput({ companyId: COMPANY, title: 'x'.repeat(MAX_TITLE_LENGTH + 1) }).valid).toBe(false);
            expect(validatePageInput({ companyId: COMPANY, title: 'X', projectId: 'bad' }).valid).toBe(false);
        });
    });

    describe('contentTooLarge', () => {

        test('normal bodies pass, megabyte bodies fail', () => {
            expect(contentTooLarge({ html: '<p>hello</p>' })).toBe(false);
            expect(contentTooLarge({ html: 'x'.repeat(600 * 1024) })).toBe(true);
        });
    });

    describe('review cycle', () => {

        const NOW = new Date('2026-09-03T10:00:00Z');

        test('plain docs have no review state', () => {
            expect(reviewState({ isWiki: false, reviewDate: '2020-01-01' }, NOW)).toBe('none');
            expect(reviewState(null, NOW)).toBe('none');
        });

        test('a wiki page is verified until its review date, due after, stale three months later', () => {
            expect(reviewState({ isWiki: true, reviewDate: '2026-10-01' }, NOW)).toBe('verified');
            expect(reviewState({ isWiki: true, reviewDate: '2026-08-20' }, NOW)).toBe('due');
            expect(reviewState({ isWiki: true, reviewDate: '2026-02-11' }, NOW)).toBe('stale');
        });

        test('a wiki page with no date is due unless it was reviewed once', () => {
            expect(reviewState({ isWiki: true }, NOW)).toBe('due');
            expect(reviewState({ isWiki: true, reviewedAt: '2026-09-01' }, NOW)).toBe('verified');
        });

        test('nextReviewDate is the interval out and parseDate rejects junk', () => {
            const next = nextReviewDate(NOW);
            expect(next.getMonth()).toBe((NOW.getMonth() + REVIEW_INTERVAL_MONTHS) % 12);
            expect(parseDate('nope')).toBeNull();
            expect(parseDate('')).toBeNull();
            expect(parseDate('2026-09-03').getFullYear()).toBe(2026);
        });
    });

    describe('htmlToRawText', () => {

        test('strips tags and collapses whitespace', () => {
            expect(htmlToRawText('<h1>Title</h1>\n<p>Some&nbsp;<b>bold</b>   text</p>')).toBe('Title Some bold text');
        });

        test('caps the output length and is null-safe', () => {
            expect(htmlToRawText('<p>' + 'word '.repeat(2000) + '</p>', 100).length).toBeLessThanOrEqual(100);
            expect(htmlToRawText(null)).toBe('');
        });
    });
});
