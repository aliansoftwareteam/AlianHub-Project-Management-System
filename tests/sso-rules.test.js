/**
 * SSO Rules Test Suite (SEC-02)
 * AlianHub Project Management System
 *
 * Unit tests for Modules/SSO/helpers/ssoRules.js. Pure — no DB / no IdP.
 */

const { SSO_PROVIDERS, validateSsoConfig, publicSsoView, extractIdentity } = require('../Modules/SSO/helpers/ssoRules');

describe('🔑 SSO - Rules (SEC-02)', () => {

    describe('validateSsoConfig', () => {
        test('valid OIDC config', () => {
            expect(validateSsoConfig({ provider: 'oidc', oidc: { issuer: 'https://idp', clientId: 'c', clientSecret: 's' } }).valid).toBe(true);
        });
        test('valid SAML config', () => {
            expect(validateSsoConfig({ provider: 'saml', saml: { entryPoint: 'https://idp/sso', idpCert: 'CERT' } }).valid).toBe(true);
        });
        test('bad provider fails', () => expect(validateSsoConfig({ provider: 'ldap' }).valid).toBe(false));
        test('OIDC missing clientSecret fails', () => expect(validateSsoConfig({ provider: 'oidc', oidc: { issuer: 'x', clientId: 'c' } }).valid).toBe(false));
        test('OIDC missing issuer/discovery fails', () => expect(validateSsoConfig({ provider: 'oidc', oidc: { clientId: 'c', clientSecret: 's' } }).valid).toBe(false));
        test('SAML missing cert fails', () => expect(validateSsoConfig({ provider: 'saml', saml: { entryPoint: 'x' } }).valid).toBe(false));
    });

    describe('publicSsoView (no secret leak)', () => {
        test('exposes only what the login page needs, never a secret', () => {
            const v = publicSsoView({ provider: 'oidc', isEnabled: true, displayName: 'Okta', enforcement: 'required', oidc: { clientSecret: 'TOPSECRET' } });
            expect(v).toEqual({ provider: 'oidc', isEnabled: true, displayName: 'Okta', enforcement: 'required' });
            expect(JSON.stringify(v)).not.toContain('TOPSECRET');
        });
        test('display name and enforcement default rather than leak undefined', () => {
            expect(publicSsoView({ provider: 'saml', isEnabled: true })).toEqual({ provider: 'saml', isEnabled: true, displayName: '', enforcement: 'optional' });
        });
        test('null when disabled or missing', () => {
            expect(publicSsoView({ provider: 'oidc', isEnabled: false })).toBeNull();
            expect(publicSsoView(null)).toBeNull();
        });
    });

    describe('extractIdentity', () => {
        test('standard OIDC claims', () => {
            const id = extractIdentity({ email: 'A@X.com', given_name: 'Ann', family_name: 'Lee', sub: 'abc' });
            expect(id.valid).toBe(true);
            expect(id.email).toBe('a@x.com');
            expect(id.firstName).toBe('Ann');
            expect(id.lastName).toBe('Lee');
            expect(id.externalId).toBe('abc');
        });
        test('falls back to full name then email local-part', () => {
            const id = extractIdentity({ email: 'b@x.com', name: 'Bob Q Smith' });
            expect(id.firstName).toBe('Bob');
            expect(id.lastName).toBe('Q Smith');
            const id2 = extractIdentity({ email: 'solo@x.com' });
            expect(id2.firstName).toBe('solo');
            expect(id2.lastName).toBe('-');
        });
        test('custom SAML attribute map', () => {
            const id = extractIdentity({ 'urn:email': 'c@x.com', nameID: 'nid' }, { email: 'urn:email' });
            expect(id.valid).toBe(true);
            expect(id.email).toBe('c@x.com');
            expect(id.externalId).toBe('nid');
        });
        test('missing/invalid email fails', () => {
            expect(extractIdentity({}).valid).toBe(false);
            expect(extractIdentity({ email: 'not-an-email' }).valid).toBe(false);
        });
    });

    test('SSO_PROVIDERS', () => expect(SSO_PROVIDERS).toEqual(['oidc', 'saml']));
});
