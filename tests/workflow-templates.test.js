const mockDbs = {};
const mockDbFor = (id) => { mockDbs[id] = mockDbs[id] || require('./fixtures/fakeMongo').create(); return mockDbs[id]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

process.env.WORKFLOW_ENGINE = 'on';
process.env.DISPATCHER = 'on';

const { SCHEMA_TYPE } = require('../Config/schemaType');
const stepTypes = require('../Modules/Workflows/stepTypes');
const templates = require('../Modules/Workflows/templates');
const definitions = require('../Modules/Workflows/definitions');
const playbooks = require('../Modules/Agents/rolePlaybooks');

const EXPECTED = [
    'marketing-campaign-launch', 'design-request-to-handoff', 'engineering-design-to-release', 'support-customer-bug', 'sales-new-customer-onboarding',
    'manufacturing-order-to-dispatch', 'manufacturing-quality-problem', 'manufacturing-breakdown',
];

describe('the ready-made team workflows', () => {
    it('are the five of the team design and the three manufacturing ones', () => {
        expect(templates.all().map((template) => template.key)).toEqual(EXPECTED);
    });

    it.each(EXPECTED)('%s only uses hand-overs and approvals, valid together', (key) => {
        const template = templates.find(key);
        expect(template.steps.every((step) => ['role_handoff', 'human_approval'].includes(step.type))).toBe(true);
        if (key !== 'manufacturing-breakdown') expect(template.steps.some((step) => step.type === 'human_approval')).toBe(true);
        expect(stepTypes.validateSteps(template.steps)).toEqual({ valid: true, errors: [] });
    });

    it('name only roles that exist in Modules/Agents/roles', () => {
        templates.all().forEach((template) => templates.roleKeysOf(template).forEach((key) => {
            const [blueprint, slug] = key.split('/');
            expect(playbooks.find(blueprint, slug)).not.toBeNull();
        }));
    });

    it('run one step after another, each gate between the roles it separates', () => {
        templates.all().forEach((template) => template.steps.forEach((step, i) => {
            expect(step.dependsOn).toEqual(i === 0 ? [] : [template.steps[i - 1].id]);
        }));
        expect(templates.find('marketing-campaign-launch').steps.map((step) => step.type)).toEqual([
            'role_handoff', 'human_approval', 'role_handoff', 'role_handoff', 'role_handoff', 'human_approval', 'role_handoff', 'role_handoff',
        ]);
    });

    it('end with a person where an agent must not send anything outside AlianHub', () => {
        ['support-customer-bug', 'manufacturing-order-to-dispatch'].forEach((key) => {
            expect(templates.find(key).steps.at(-1).type).toBe('human_approval');
        });
    });

    it('are installed disabled, and a copy cannot change the template', async () => {
        const copy = templates.copyOf(templates.find('manufacturing-breakdown'));
        copy.steps[0].config.role = 'changed';
        expect(templates.find('manufacturing-breakdown').steps[0].config.role).toBe('manufacturing/breakdown-triage');
        const saved = await definitions.create('6d0000000000000000000001', { ...templates.copyOf(templates.find('manufacturing-breakdown')), by: 'u1' });
        expect(saved.enabled).toBe(false);
        expect(mockDbFor('6d0000000000000000000001').store[SCHEMA_TYPE.WORKFLOW_DEFINITIONS]).toHaveLength(1);
    });

    it('have routes behind the manager check and the person-only guard', () => {
        const table = {};
        const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers.length; };
        require('../Modules/Workflows/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE') });
        expect(table['GET /api/v2/workflows/templates']).toBe(1);
        expect(table['POST /api/v2/workflows/templates/:key/install']).toBe(2);
    });
});
