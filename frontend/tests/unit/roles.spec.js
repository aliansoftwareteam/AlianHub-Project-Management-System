import { describe, expect, it } from 'vitest';
import { ROLE_GUEST, ROLE_OWNER, ROLE_ADMIN, ROLE_MEMBER, isOwnerOrAdmin } from '@/utils/roles';

describe('roles', () => {
    it('uses the seeded role keys', () => {
        expect([ROLE_GUEST, ROLE_OWNER, ROLE_ADMIN, ROLE_MEMBER]).toEqual([0, 1, 2, 3]);
    });

    it('treats only owner and admin as owner-or-admin', () => {
        expect([ROLE_GUEST, ROLE_OWNER, ROLE_ADMIN, ROLE_MEMBER].map(isOwnerOrAdmin)).toEqual([false, true, true, false]);
    });

    it('does not coerce missing or string roles', () => {
        expect([undefined, null, '1', '2', NaN].map(isOwnerOrAdmin)).toEqual([false, false, false, false, false]);
    });
});
