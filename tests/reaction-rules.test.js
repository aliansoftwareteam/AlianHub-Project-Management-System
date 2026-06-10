/**
 * Reaction Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Reactions/helpers/reactionRules.js — the pure
 * rules module behind POST /api/v2/reactions. No DB or network needed.
 */

const {
    REACTION_EMOJIS,
    TARGET_TYPES,
    isObjectIdString,
    validateReactionInput,
} = require('../Modules/Reactions/helpers/reactionRules');

const COMPANY_ID = '64b7f0c2a1b2c3d4e5f60700';
const TARGET_ID = '64b7f0c2a1b2c3d4e5f60718';
const USER_ID = 'user-123';

describe('😀 REACTIONS - Rules', () => {

    describe('Definitions', () => {

        test('the emoji allowlist is non-empty and frozen', () => {
            expect(REACTION_EMOJIS.length).toBeGreaterThan(0);
            expect(Object.isFrozen(REACTION_EMOJIS)).toBe(true);
        });

        test('target types are exactly task and comment', () => {
            expect([...TARGET_TYPES].sort()).toEqual(['comment', 'task']);
        });
    });

    describe('validateReactionInput', () => {

        const valid = {
            companyId: COMPANY_ID,
            targetType: 'task',
            targetId: TARGET_ID,
            emoji: REACTION_EMOJIS[0],
            userId: USER_ID,
        };

        test('a fully valid task reaction passes', () => {
            expect(validateReactionInput(valid).valid).toBe(true);
        });

        test('a fully valid comment reaction passes', () => {
            expect(validateReactionInput({ ...valid, targetType: 'comment' }).valid).toBe(true);
        });

        test('every allowlisted emoji passes', () => {
            REACTION_EMOJIS.forEach((emoji) => {
                expect(validateReactionInput({ ...valid, emoji }).valid).toBe(true);
            });
        });

        test('missing companyId fails', () => {
            const result = validateReactionInput({ ...valid, companyId: '' });
            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/companyId/);
        });

        test('unknown targetType fails', () => {
            const result = validateReactionInput({ ...valid, targetType: 'project' });
            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/targetType/);
        });

        test('malformed targetId fails', () => {
            const result = validateReactionInput({ ...valid, targetId: 'not-an-id' });
            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/targetId/);
        });

        test('non-allowlisted emoji fails', () => {
            const result = validateReactionInput({ ...valid, emoji: '🦄' });
            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/emoji/i);
        });

        test('free-text emoji field fails (no junk strings)', () => {
            const result = validateReactionInput({ ...valid, emoji: '<script>' });
            expect(result.valid).toBe(false);
        });

        test('missing userId fails', () => {
            const result = validateReactionInput({ ...valid, userId: '' });
            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/userId/);
        });
    });

    describe('isObjectIdString', () => {

        test('accepts 24-char hex, rejects everything else', () => {
            expect(isObjectIdString(TARGET_ID)).toBe(true);
            expect(isObjectIdString('xyz')).toBe(false);
            expect(isObjectIdString(null)).toBe(false);
        });
    });
});
