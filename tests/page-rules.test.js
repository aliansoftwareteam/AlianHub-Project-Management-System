/**
 * Page Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Pages/helpers/pageRules.js. Pure — no DB.
 */

const {
    MAX_TITLE_LENGTH,
    validatePageInput,
    contentTooLarge,
    htmlToRawText,
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
