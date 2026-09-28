const mockCrud = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { updateProjectRules } = require('../Modules/projectRules/controller');

const COMPANY = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000b01';
const RULE = '6f00000000000000000000a1';

const call = async (body) => {
    const res = { statusCode: 200 };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((payload) => { res.body = payload; return res; });
    await updateProjectRules({ body, headers: { companyid: COMPANY } }, res);
    return res;
};
const writtenUpdate = () => mockCrud.mock.calls.filter(([, , method]) => method === 'findOneAndUpdate').map(([, arg]) => arg.data[1]);

beforeEach(() => {
    mockCrud.mockReset();
    mockCrud.mockImplementation(async (companyId, arg, method) => (method === 'findOneAndUpdate' ? { _id: RULE, ...arg.data[1].$set } : null));
});

/* The web app only ever sets a rule's roles (SecurityPermissions.vue); the server must not let the
 * request choose the operator or the fields. */
describe('updating a project rule', () => {
    it('sets the roles the web app sends', async () => {
        const roles = [{ key: 3, permission: true }, { key: 0, permission: null }];
        const res = await call({ id: RULE, projectId: PROJECT, key: '$set', updateObject: { roles } });
        expect(res.statusCode).toBe(200);
        expect(writtenUpdate()).toEqual([{ $set: { roles } }]);
    });

    it('never applies another update operator', async () => {
        const res = await call({ id: RULE, projectId: PROJECT, key: '$unset', updateObject: { roles: 1 } });
        expect(res.statusCode).toBe(400);
        expect(writtenUpdate()).toEqual([]);
    });

    it('never writes a field other than roles', async () => {
        const res = await call({ id: RULE, projectId: PROJECT, key: '$set', updateObject: { roles: [], projectId: '6f0000000000000000000b02' } });
        expect(res.statusCode).toBe(400);
        expect(writtenUpdate()).toEqual([]);
    });

    it('refuses roles that are not role entries', async () => {
        for (const roles of ['all', [{ key: 3, permission: true, extra: { $where: 'x' } }], [{ permission: true }], Array.from({ length: 101 }, (_, key) => ({ key, permission: true }))]) {
            const res = await call({ id: RULE, projectId: PROJECT, key: '$set', updateObject: { roles } });
            expect(res.statusCode).toBe(400);
        }
        expect(writtenUpdate()).toEqual([]);
    });
});
