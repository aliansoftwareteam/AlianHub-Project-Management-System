const { hasScope } = require('../Modules/ApiTokens/helpers/apiTokenRules');
const { TOOL_SCOPES, grantedScopes } = require('../Modules/Mcp/scopes');

const READS = ['tasks:read', 'projects:read', 'docs:read', 'time:read'];
const WRITES = ['tasks:write', 'time:write'];
const token = (scopes) => ({ _id: 't1', userId: 'u1', scopes, createdAt: new Date(), expiresAt: new Date(Date.now() + 86400000) });

afterEach(() => { delete process.env.API_TOKEN_STRICT; });

describe.each([['off', undefined], ['on', 'true']])('personal access tokens with API_TOKEN_STRICT %s', (label, flag) => {
    beforeEach(() => { if (flag) process.env.API_TOKEN_STRICT = flag; });

    it.each([
        [['read'], READS],
        [['write'], WRITES],
        [['read', 'write'], [...READS, ...WRITES]],
        [[], [...READS, ...WRITES]],
    ])('scopes %o grant %o', (scopes, expected) => {
        expect([...grantedScopes(token(scopes))].sort()).toEqual([...expected].sort());
    });

    it.each([[['read']], [['write']], [['read', 'write']], [[]]])('scopes %o reach exactly the tools they reach today', (scopes) => {
        const doc = token(scopes);
        const granted = grantedScopes(doc);
        for (const [tool, scope] of Object.entries(TOOL_SCOPES)) {
            const today = hasScope(doc, scope.endsWith(':write') ? 'write' : 'read');
            expect({ tool, allowed: granted.includes(scope) }).toEqual({ tool, allowed: today });
        }
    });
});

it('passes a token\'s own fine-grained scopes through and ignores unknown ones', () => {
    expect(grantedScopes(token(['tasks:read', 'admin:all']))).toEqual(['tasks:read']);
});
