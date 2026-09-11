jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({}));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(async () => ({})) }));
jest.mock('../utils/enterpriseHelper', () => ({ getCachedGlobalTemplateData: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async (companyId, skills) => skills || []) }));
jest.mock('../utils/sampleTasks', () => ({ seedSampleTasks: jest.fn(), sampleTasksForTemplate: jest.fn(() => null) }));

const controller = require('../Modules/createProject/controller');
const { updateCompanyFun } = require('../Modules/Company/controller/updateCompany');

const COMPANY_A = '6a8ee973d625fca52e519a12';
const COMPANY_B = '6b8ee973d625fca52e519b34';

const response = () => {
    const res = { statusCode: 200 };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
};

const request = ({ header = COMPANY_A, aud = COMPANY_A, body = {} } = {}) => ({
    headers: header ? { companyid: header } : {},
    aud,
    uid: '6f0000000000000000000a01',
    body: { ProjectName: 'Launch', isPrivateSpace: false, ...body },
});

const flush = async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
});

describe('createProjectFun pins the tenant to the companyid header', () => {
    it('refuses a body that names another company before anything is written', async () => {
        const plan = jest.spyOn(controller, 'checkProjectPlan');
        const create = jest.spyOn(controller, 'createProject');
        const res = response();

        await controller.createProjectFun(request({ body: { CompanyId: COMPANY_B } }), res);
        await flush();

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.send.mock.calls[0][0]).toMatchObject({ status: false });
        expect(plan).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
        expect(updateCompanyFun).not.toHaveBeenCalled();
    });

    it('refuses a lower-case body companyId that names another company', async () => {
        const plan = jest.spyOn(controller, 'checkProjectPlan');
        const res = response();

        await controller.createProjectFun(request({ body: { companyId: COMPANY_B } }), res);
        await flush();

        expect(res.status).toHaveBeenCalledWith(403);
        expect(plan).not.toHaveBeenCalled();
    });

    it('refuses a header company outside the session audience', async () => {
        const plan = jest.spyOn(controller, 'checkProjectPlan');
        const res = response();

        await controller.createProjectFun(request({ header: COMPANY_B, aud: COMPANY_A, body: { CompanyId: COMPANY_B } }), res);
        await flush();

        expect(res.status).toHaveBeenCalledWith(403);
        expect(plan).not.toHaveBeenCalled();
    });

    it('creates in the header company when the body leaves the company out', async () => {
        const plan = jest.spyOn(controller, 'checkProjectPlan').mockResolvedValue({ status: true });
        const create = jest.spyOn(controller, 'createProject').mockResolvedValue({ status: true, data: { _id: 'p1' } });
        const res = response();

        await controller.createProjectFun(request(), res);
        await flush();

        expect(plan.mock.calls[0][0].body.CompanyId).toBe(COMPANY_A);
        expect(create.mock.calls[0][0].body.CompanyId).toBe(COMPANY_A);
        expect(res.send).toHaveBeenCalledWith({ status: true, data: { _id: 'p1' } });
    });

    it('rolls the project count back in the header company when creation fails', async () => {
        jest.spyOn(controller, 'checkProjectPlan').mockResolvedValue({ status: true });
        jest.spyOn(controller, 'createProject').mockRejectedValue({ status: false, statusText: 'error in creating project' });
        const rollback = jest.spyOn(controller, 'removeProjectCount').mockImplementation(() => {});
        const res = response();

        await controller.createProjectFun(request({ body: { CompanyId: COMPANY_A } }), res);
        await flush();

        expect(rollback).toHaveBeenCalledWith(COMPANY_A, false);
        expect(res.send.mock.calls[0][0]).toMatchObject({ status: false });
    });
});
