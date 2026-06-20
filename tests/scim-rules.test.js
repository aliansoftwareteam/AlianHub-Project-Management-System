const R = require('../Modules/Scim/helpers/scimRules');

describe('SCIM token (build/parse)', () => {
    test('round-trips companyId + secret', () => {
        const tok = R.buildScimToken('cmp123', 'sekret');
        expect(typeof tok).toBe('string');
        const parsed = R.parseScimToken(tok);
        expect(parsed).toEqual({ companyId: 'cmp123', secret: 'sekret' });
    });
    test('preserves a secret that contains colons', () => {
        const parsed = R.parseScimToken(R.buildScimToken('cmp', 'a:b:c'));
        expect(parsed).toEqual({ companyId: 'cmp', secret: 'a:b:c' });
    });
    test('rejects empty / malformed tokens', () => {
        expect(R.parseScimToken('')).toBeNull();
        expect(R.parseScimToken(null)).toBeNull();
        expect(R.buildScimToken('', 'x')).toBe('');
        // base64url of "nocolon" → no separator → null
        expect(R.parseScimToken(Buffer.from('nocolon', 'utf8').toString('base64url'))).toBeNull();
    });
});

describe('extractEmail', () => {
    test('prefers userName when it is an email', () => {
        expect(R.extractEmail({ userName: 'A@B.com', emails: [{ value: 'x@y.com' }] })).toBe('a@b.com');
    });
    test('falls back to primary email', () => {
        expect(R.extractEmail({ userName: 'jdoe', emails: [{ value: 'p@q.com', primary: true }, { value: 'x@y.com' }] })).toBe('p@q.com');
    });
    test('returns empty when nothing usable', () => {
        expect(R.extractEmail({})).toBe('');
        expect(R.extractEmail(null)).toBe('');
    });
});

describe('parseUserNameFilter', () => {
    test('parses userName eq', () => {
        expect(R.parseUserNameFilter('userName eq "Bob@Co.com"')).toBe('bob@co.com');
    });
    test('parses emails.value eq', () => {
        expect(R.parseUserNameFilter('emails.value eq "z@co.com"')).toBe('z@co.com');
    });
    test('null for unsupported / empty filters', () => {
        expect(R.parseUserNameFilter('displayName co "x"')).toBeNull();
        expect(R.parseUserNameFilter('')).toBeNull();
    });
});

describe('isActive', () => {
    test('active by default', () => {
        expect(R.isActive({ userId: '1' })).toBe(true);
        expect(R.isActive({ status: 1 })).toBe(true);
    });
    test('inactive when soft-deleted or status 0', () => {
        expect(R.isActive({ isDelete: true })).toBe(false);
        expect(R.isActive({ status: 0 })).toBe(false);
        expect(R.isActive(null)).toBe(false);
    });
});

describe('toScimUser', () => {
    test('maps a global user + membership to a SCIM resource', () => {
        const gu = { _id: 'u1', Employee_Email: 'p@q.com', Employee_FName: 'Pat', Employee_LName: 'Lee', Employee_Name: 'Pat Lee' };
        const cu = { userId: 'u1', status: 1 };
        const r = R.toScimUser(gu, cu, 'https://h/scim/v2');
        expect(r.id).toBe('u1');
        expect(r.userName).toBe('p@q.com');
        expect(r.name).toEqual({ givenName: 'Pat', familyName: 'Lee', formatted: 'Pat Lee' });
        expect(r.emails).toEqual([{ value: 'p@q.com', primary: true }]);
        expect(r.active).toBe(true);
        expect(r.meta.location).toBe('https://h/scim/v2/Users/u1');
        expect(r.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
    });
    test('reflects deactivation', () => {
        const r = R.toScimUser({ _id: 'u2', Employee_Email: 'x@y.com' }, { userId: 'u2', isDelete: true });
        expect(r.active).toBe(false);
    });
});

describe('listResponse', () => {
    test('wraps resources with SCIM list envelope', () => {
        const lr = R.listResponse([{ id: 'a' }], 1, 5);
        expect(lr.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
        expect(lr.totalResults).toBe(5);
        expect(lr.itemsPerPage).toBe(1);
        expect(lr.startIndex).toBe(1);
        expect(lr.Resources).toHaveLength(1);
    });
});

describe('parsePatchOps', () => {
    test('replace active:false (Okta deactivate)', () => {
        expect(R.parsePatchOps({ Operations: [{ op: 'replace', path: 'active', value: false }] })).toEqual({ active: false });
    });
    test('Azure pathless value object', () => {
        const ops = R.parsePatchOps({ Operations: [{ op: 'Replace', value: { active: true, name: { givenName: 'Jo' } } }] });
        expect(ops.active).toBe(true);
        expect(ops.givenName).toBe('Jo');
    });
    test('string "False" coerces to boolean', () => {
        expect(R.parsePatchOps({ Operations: [{ op: 'replace', path: 'active', value: 'False' }] })).toEqual({ active: false });
    });
    test('ignores unknown ops / paths', () => {
        expect(R.parsePatchOps({ Operations: [{ op: 'remove', path: 'emails' }] })).toEqual({});
        expect(R.parsePatchOps({})).toEqual({});
    });
});

describe('scimError', () => {
    test('shapes a SCIM error', () => {
        const e = R.scimError(404, 'nope');
        expect(e.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
        expect(e.status).toBe('404');
        expect(e.detail).toBe('nope');
    });
});
