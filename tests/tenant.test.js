const { tenantOf, TenantError } = require('../Config/tenant');

const COMPANY = '64b1f0c2a1b2c3d4e5f60718';
const OTHER = '64b1f0c2a1b2c3d4e5f60719';

describe('tenantOf', () => {
    it('takes the companyid header when it is in the JWT audience', () => {
        expect(tenantOf({ headers: { companyid: COMPANY }, aud: `${OTHER},${COMPANY}` })).toBe(COMPANY);
    });

    it('accepts the single audience of an API token', () => {
        expect(tenantOf({ headers: { companyid: COMPANY }, aud: COMPANY })).toBe(COMPANY);
    });

    it('falls back to params, query, then body', () => {
        expect(tenantOf({ headers: {}, params: { companyId: COMPANY } })).toBe(COMPANY);
        expect(tenantOf({ headers: {}, query: { companyId: COMPANY } })).toBe(COMPANY);
        expect(tenantOf({ headers: {}, body: { CompanyId: COMPANY } })).toBe(COMPANY);
    });

    it('rejects a company outside the audience', () => {
        expect(() => tenantOf({ headers: { companyid: OTHER }, aud: COMPANY })).toThrow(TenantError);
    });

    it.each(['', 'global', '.*', 'USER_PROFILES', `${COMPANY}x`])('rejects %p as a tenant id', (value) => {
        expect(() => tenantOf({ headers: { companyid: value } })).toThrow(TenantError);
    });

    it('carries a 403 for strictStatus', () => {
        try {
            tenantOf({ headers: {} });
        } catch (error) {
            expect(error.statusCode).toBe(403);
            expect(error.name).toBe('TenantError');
        }
    });
});
