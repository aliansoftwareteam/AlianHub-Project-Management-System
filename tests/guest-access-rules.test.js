/**
 * Guest Access Rules Test Suite (SEC-01)
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Auth/helpers/guestAccessRules.js. Pure — no DB.
 */

const { ROLE_GUEST, isGuest, guestAllowsProject } = require('../Modules/Auth/helpers/guestAccessRules');

describe('🔒 GUEST ACCESS - Rules (SEC-01)', () => {

    describe('isGuest', () => {
        test('ROLE_GUEST is 4', () => expect(ROLE_GUEST).toBe(4));
        test('roleType 4 is a guest', () => expect(isGuest(4)).toBe(true));
        test('owner / admin / member are not guests', () => {
            expect(isGuest(1)).toBe(false);
            expect(isGuest(2)).toBe(false);
            expect(isGuest(3)).toBe(false);
        });
        test('null / undefined is not a guest', () => {
            expect(isGuest(null)).toBe(false);
            expect(isGuest(undefined)).toBe(false);
        });
    });

    describe('guestAllowsProject', () => {
        const ids = ['p1', 'p2'];
        test('allows an assigned project', () => expect(guestAllowsProject({ guestProjectIds: ids, projectId: 'p1' })).toBe(true));
        test('denies an unassigned project', () => expect(guestAllowsProject({ guestProjectIds: ids, projectId: 'p9' })).toBe(false));
        test('denies when nothing assigned', () => expect(guestAllowsProject({ guestProjectIds: [], projectId: 'p1' })).toBe(false));
        test('denies a missing/empty projectId', () => {
            expect(guestAllowsProject({ guestProjectIds: ids })).toBe(false);
            expect(guestAllowsProject({ guestProjectIds: ids, projectId: '' })).toBe(false);
        });
        test('matches across string / ObjectId-like types', () => {
            expect(guestAllowsProject({ guestProjectIds: [{ toString: () => 'p1' }], projectId: 'p1' })).toBe(true);
        });
        test('handles missing args', () => expect(guestAllowsProject()).toBe(false));
    });
});
