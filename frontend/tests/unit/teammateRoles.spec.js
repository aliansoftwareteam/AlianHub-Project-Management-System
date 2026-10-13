import { describe, expect, it } from 'vitest';
import { teammateRoleKeys } from '@/views/Ai/teammateRoles';
import { ROLE_ADMIN, ROLE_GUEST, ROLE_MEMBER, ROLE_OWNER } from '@/utils/roles';

describe('People rows on the teammates screen', () => {
    it.each([
        [ROLE_OWNER, 'Parity.role_owner', 'Parity.everything'],
        [ROLE_ADMIN, 'Parity.role_admin', 'Parity.everything'],
        [ROLE_MEMBER, 'Parity.role_member', 'Parity.access_member'],
        [ROLE_GUEST, 'Parity.role_guest', 'Parity.access_guest'],
    ])('role %i reads as %s with access %s', (roleType, role, access) => {
        expect(teammateRoleKeys(roleType)).toEqual({ role, access });
    });

    it('never grants an unknown role the "Everything" access label', () => {
        expect(teammateRoleKeys(undefined).access).not.toBe('Parity.everything');
        expect(teammateRoleKeys(9).access).not.toBe('Parity.everything');
    });
});
