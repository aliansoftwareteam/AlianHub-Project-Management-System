const { tenantOf, sessionTenantOf, pinSessionTenant, TenantError } = require('../Config/tenant');

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
        expect(tenantOf({ headers: {}, params: { companyId: COMPANY }, aud: COMPANY })).toBe(COMPANY);
        expect(tenantOf({ headers: {}, query: { companyId: COMPANY }, aud: COMPANY })).toBe(COMPANY);
        expect(tenantOf({ headers: {}, body: { CompanyId: COMPANY }, aud: COMPANY })).toBe(COMPANY);
    });

    it.each([undefined, null, ''])('refuses a request whose audience is %p', (aud) => {
        expect(() => tenantOf({ headers: { companyid: COMPANY }, aud })).toThrow(TenantError);
        expect(() => tenantOf({ headers: {}, body: { companyId: COMPANY }, aud })).toThrow(TenantError);
    });

    it('takes the named company for the instance admin key, which carries no token', () => {
        expect(tenantOf({ headers: { companyid: COMPANY }, instanceAdmin: 'key' })).toBe(COMPANY);
    });

    it('holds the instance owner to the companies in their token', () => {
        expect(() => tenantOf({ headers: { companyid: OTHER }, aud: COMPANY, instanceAdmin: 'owner' })).toThrow(TenantError);
        expect(() => tenantOf({ headers: { companyid: COMPANY }, instanceAdmin: 'owner' })).toThrow(TenantError);
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

describe('sessionTenantOf', () => {
    it('takes the header when nothing else names a company', () => {
        expect(sessionTenantOf({ headers: { companyid: COMPANY }, body: {}, aud: COMPANY })).toBe(COMPANY);
    });

    it('accepts a body that repeats the header', () => {
        expect(sessionTenantOf({ headers: { companyid: COMPANY }, body: { companyId: COMPANY }, aud: COMPANY })).toBe(COMPANY);
    });

    it.each([
        ['body', { headers: { companyid: COMPANY }, body: { companyId: OTHER } }],
        ['query', { headers: { companyid: COMPANY }, query: { companyId: OTHER } }],
    ])('refuses a %s that names a second company', (_label, req) => {
        expect(() => sessionTenantOf({ ...req, aud: `${COMPANY},${OTHER}` })).toThrow(TenantError);
    });
});

describe('pinSessionTenant', () => {
    const spyRes = () => {
        const res = { statusCode: 0, payload: null };
        res.status = (code) => { res.statusCode = code; return res; };
        res.send = (payload) => { res.payload = payload; return res; };
        return res;
    };

    it('pins the body to the header and returns the company', () => {
        const req = { headers: { companyid: COMPANY }, body: { companyId: COMPANY, CompanyId: COMPANY }, aud: COMPANY };
        const res = spyRes();
        expect(pinSessionTenant(req, res)).toBe(COMPANY);
        expect(req.body).toEqual({ companyId: COMPANY, CompanyId: COMPANY });
        expect(res.statusCode).toBe(0);
    });

    it('fills in a body that names no company', () => {
        const req = { headers: { companyid: COMPANY }, body: { description: 'work' }, aud: COMPANY };
        expect(pinSessionTenant(req, spyRes())).toBe(COMPANY);
        expect(req.body.companyId).toBe(COMPANY);
        expect(req.body.CompanyId).toBeUndefined();
    });

    it.each([
        ['companyId', { companyId: OTHER }],
        ['CompanyId', { CompanyId: OTHER }],
    ])('answers 403 and leaves the body alone when %s names another company', (_label, body) => {
        const req = { headers: { companyid: COMPANY }, body, aud: `${COMPANY},${OTHER}` };
        const res = spyRes();
        expect(pinSessionTenant(req, res)).toBe('');
        expect(res.statusCode).toBe(403);
        expect(res.payload.status).toBe(false);
        expect(req.body).toEqual(body);
    });

    it('answers 403 to a request that carries no audience', () => {
        const req = { headers: { companyid: COMPANY }, body: { companyId: COMPANY } };
        const res = spyRes();
        expect(pinSessionTenant(req, res)).toBe('');
        expect(res.statusCode).toBe(403);
        expect(() => sessionTenantOf({ headers: { companyid: COMPANY }, body: {} })).toThrow(TenantError);
    });

    it('answers 403 when the body carries an object instead of a company id', () => {
        const req = { headers: {}, body: { companyId: { $ne: null } } };
        const res = spyRes();
        expect(pinSessionTenant(req, res)).toBe('');
        expect(res.statusCode).toBe(403);
    });
});
