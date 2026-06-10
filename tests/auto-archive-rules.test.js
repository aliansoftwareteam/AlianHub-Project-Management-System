/**
 * Auto-Archive Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for the pure rule normalisation in
 * Modules/projectSetting/autoArchive.js. No DB or network needed.
 */

const {
    normaliseRule,
    DEFAULT_AFTER_DAYS,
    MIN_AFTER_DAYS,
    MAX_AFTER_DAYS,
} = require('../Modules/projectSetting/autoArchiveRules');

describe('🗄️ AUTO-ARCHIVE - Rule normalisation', () => {

    test('a valid enabled rule passes through', () => {
        expect(normaliseRule({ enabled: true, afterDays: 14 })).toEqual({ enabled: true, afterDays: 14 });
    });

    test('enabled must be exactly true — truthy junk disables', () => {
        expect(normaliseRule({ enabled: 'yes', afterDays: 14 }).enabled).toBe(false);
        expect(normaliseRule({ enabled: 1, afterDays: 14 }).enabled).toBe(false);
    });

    test('missing or junk afterDays falls back to the default', () => {
        expect(normaliseRule({ enabled: true }).afterDays).toBe(DEFAULT_AFTER_DAYS);
        expect(normaliseRule({ enabled: true, afterDays: 'soon' }).afterDays).toBe(DEFAULT_AFTER_DAYS);
    });

    test('afterDays clamps to the allowed range', () => {
        expect(normaliseRule({ enabled: true, afterDays: 0 }).afterDays).toBe(MIN_AFTER_DAYS);
        expect(normaliseRule({ enabled: true, afterDays: -10 }).afterDays).toBe(MIN_AFTER_DAYS);
        expect(normaliseRule({ enabled: true, afterDays: 9999 }).afterDays).toBe(MAX_AFTER_DAYS);
    });

    test('fractional afterDays rounds to whole days', () => {
        expect(normaliseRule({ enabled: true, afterDays: 6.6 }).afterDays).toBe(7);
    });

    test('undefined input yields a disabled default rule', () => {
        expect(normaliseRule(undefined)).toEqual({ enabled: false, afterDays: DEFAULT_AFTER_DAYS });
    });
});
