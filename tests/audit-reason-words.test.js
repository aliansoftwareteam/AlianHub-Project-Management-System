/* A reason the server writes as a code is read in a sentence (frontend/src/views/Ai/auditWords.js). Every code of
   every list of them has its sentence in en.js, so a code added to a list fails here instead of showing raw. */
const fs = require('fs');
const path = require('path');

const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SRC, loadLocale } = require('./conventions/locale-keys');
const undo = require('../Modules/Agents/undo');
const revert = require('../Modules/Agents/revert');
const spendGuard = require('../Modules/Agents/spendGuard');
const permissions = require('../Modules/Agents/permissions');
const visibility = require('../Modules/Mcp/visibility');
const stepCredential = require('../Modules/Workflows/stepCredential');
const externalSession = require('../Modules/Workflows/externalSession');
const permissionDecisions = require('../Config/permissionDecisions');

const sentences = loadLocale(path.join(SRC, 'locales', 'en.js')).AuditReasons || {};
const unworded = (codes, prefix = '') => codes.filter((code) => typeof sentences[`${prefix}${code}`] !== 'string' || !sentences[`${prefix}${code}`].trim());

const safeFetch = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Agents', 'engine', 'safeFetch.js'), 'utf8');
const egressCodes = [...(/const REFUSAL = Object\.freeze\(\{([^}]+)\}\)/.exec(safeFetch) || ['', ''])[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const auditWords = fs.readFileSync(path.join(SRC, 'views', 'Ai', 'auditWords.js'), 'utf8');

describe('the reasons the server writes as codes', () => {
    it('have a sentence each: undoing a change and reverting a run', () => {
        expect(unworded([...new Set([...Object.values(undo.REASON), ...Object.values(revert.REASON)])])).toEqual([]);
    });

    it('have a sentence each: a refused permission', () => {
        expect(unworded(Object.values(permissionDecisions.REASONS))).toEqual([]);
    });

    it('have a sentence each: a site an agent was kept from', () => {
        expect(egressCodes).toEqual(expect.arrayContaining(['unlisted', 'private_address']));
        expect(unworded(egressCodes)).toEqual([]);
    });

    it('have a sentence each: an outside agent\'s step that was refused', () => {
        expect(unworded(Object.values(externalSession.REFUSAL), 'external_')).toEqual([]);
        expect(unworded(['external_refused', 'step_credential_refused'])).toEqual([]);
        expect(auditWords).toContain(`${stepCredential.REFUSAL_PREFIX}: `);
        expect(auditWords).toContain(`${externalSession.REFUSAL_PREFIX}: `);
    });

    it('have a sentence each: the codes that come in front of the server\'s own words', () => {
        const codes = [permissions.REASON, spendGuard.REASON, visibility.NOT_VISIBLE];
        expect(codes).toEqual(['permission_denied', 'spend_cap_exceeded', 'not_visible']);
        expect(unworded(codes)).toEqual([]);
        codes.forEach((code) => expect(auditWords).toMatch(new RegExp(`\\b${code}: `)));
    });

    it('are sentences, not keys', () => {
        const wrong = Object.entries(sentences).filter(([, text]) => /[a-z]_[a-z]/.test(text) || !/^[A-Z{]/.test(text)).map(([key, text]) => `${key}: ${text}`);
        expect(wrong).toEqual([]);
    });
});
