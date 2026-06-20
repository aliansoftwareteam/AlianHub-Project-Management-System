// SEC-05 — pure SCIM 2.0 helpers (no DB, no I/O). Unit-tested in
// tests/scim-rules.test.js. Keeping all parsing/shaping here means the
// controller + provisioning layers stay thin and the tricky bits are covered.

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

// Token = base64url("<companyId>:<secret>"). The company is embedded so a SCIM
// request (which carries no companyId header) can resolve its tenant BEFORE the
// secret is verified against the stored bcrypt hash.
const buildScimToken = (companyId, secret) => {
    if (!companyId || !secret) return '';
    return Buffer.from(`${companyId}:${secret}`, 'utf8').toString('base64url');
};

const parseScimToken = (token) => {
    if (!token || typeof token !== 'string') return null;
    let decoded;
    try { decoded = Buffer.from(token.trim(), 'base64url').toString('utf8'); }
    catch (e) { return null; }
    const idx = decoded.indexOf(':');
    if (idx <= 0 || idx === decoded.length - 1) return null;
    const companyId = decoded.slice(0, idx);
    const secret = decoded.slice(idx + 1);
    if (!companyId || !secret) return null;
    return { companyId, secret };
};

const coerceBool = (v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.trim().toLowerCase() === 'true';
    return !!v;
};

// Pull the email out of a SCIM User payload (userName preferred, then the
// primary/first email).
const extractEmail = (body) => {
    if (!body || typeof body !== 'object') return '';
    const un = body.userName ? String(body.userName).trim() : '';
    if (un && un.includes('@')) return un.toLowerCase();
    if (Array.isArray(body.emails) && body.emails.length) {
        const primary = body.emails.find((e) => e && e.primary) || body.emails[0];
        if (primary && primary.value) return String(primary.value).trim().toLowerCase();
    }
    return un ? un.toLowerCase() : '';
};

// Parse `userName eq "x"` / `emails.value eq "x"` filters → email or null.
const parseUserNameFilter = (filter) => {
    if (!filter || typeof filter !== 'string') return null;
    const m = filter.match(/(?:userName|emails(?:\.value)?)\s+eq\s+"([^"]+)"/i);
    return m ? m[1].trim().toLowerCase() : null;
};

const isActive = (companyUser) => {
    if (!companyUser) return false;
    if (companyUser.isDelete === true) return false;
    if (companyUser.status === 0) return false;
    return true;
};

// AlianHub (global user + per-company membership) → SCIM User resource.
const toScimUser = (globalUser, companyUser, baseUrl) => {
    const u = globalUser || {};
    const cu = companyUser || {};
    const id = String(u._id || cu.userId || '');
    const email = u.Employee_Email || cu.userEmail || '';
    const resource = {
        schemas: [USER_SCHEMA],
        id,
        userName: email,
        name: {
            givenName: u.Employee_FName || '',
            familyName: u.Employee_LName || '',
            formatted: u.Employee_Name || email,
        },
        emails: email ? [{ value: email, primary: true }] : [],
        active: isActive(cu),
        meta: { resourceType: 'User' },
    };
    if (baseUrl) resource.meta.location = `${baseUrl}/Users/${id}`;
    if (cu.scimExternalId) resource.externalId = cu.scimExternalId;
    return resource;
};

const listResponse = (resources, startIndex, totalResults) => ({
    schemas: [LIST_SCHEMA],
    totalResults: Number(totalResults) || 0,
    startIndex: Number(startIndex) || 1,
    itemsPerPage: Array.isArray(resources) ? resources.length : 0,
    Resources: Array.isArray(resources) ? resources : [],
});

const scimError = (status, detail) => ({
    schemas: [ERROR_SCHEMA],
    status: String(status),
    detail: detail || '',
});

// Normalise PATCH Operations into a flat change set. Supports the common
// replace/add ops Okta & Azure AD send for activate/deactivate + name updates,
// both path-scoped (`path:"active"`) and pathless (`value:{active,name}`).
const parsePatchOps = (body) => {
    const out = {};
    const ops = body && Array.isArray(body.Operations) ? body.Operations : [];
    for (const op of ops) {
        if (!op || typeof op !== 'object') continue;
        const verb = String(op.op || '').toLowerCase();
        if (verb !== 'replace' && verb !== 'add') continue;
        const path = op.path ? String(op.path) : '';
        const value = op.value;
        if (path.toLowerCase() === 'active') {
            out.active = coerceBool(value);
        } else if (path === 'name.givenName') {
            out.givenName = String(value == null ? '' : value);
        } else if (path === 'name.familyName') {
            out.familyName = String(value == null ? '' : value);
        } else if (!path && value && typeof value === 'object') {
            if (value.active !== undefined) out.active = coerceBool(value.active);
            if (value.name && value.name.givenName !== undefined) out.givenName = String(value.name.givenName);
            if (value.name && value.name.familyName !== undefined) out.familyName = String(value.name.familyName);
        }
    }
    return out;
};

module.exports = {
    USER_SCHEMA, LIST_SCHEMA, ERROR_SCHEMA, PATCH_SCHEMA,
    buildScimToken, parseScimToken, coerceBool, extractEmail, parseUserNameFilter,
    isActive, toScimUser, listResponse, scimError, parsePatchOps,
};
