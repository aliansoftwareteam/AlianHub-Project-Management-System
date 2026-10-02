const mockImports = { fns: {} };

jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/permissionGuard', () => {
    const roles = jest.requireActual('../Config/roleTypes');
    return {
        ROLE_OWNER: roles.ROLE_OWNER,
        isPrivileged: roles.isPrivileged,
        getRoleType: jest.fn(),
        evaluatePermission: jest.fn(),
        isWritable: (permission) => permission === true || permission === 1 || permission === 2,
    };
});
jest.mock('../utils/data', () => new Proxy({}, {
    get: (_target, name) => {
        if (name === '__esModule' || name === 'then' || typeof name !== 'string') return undefined;
        if (!mockImports.fns[name]) mockImports.fns[name] = jest.fn(async () => undefined);
        return mockImports.fns[name];
    },
}));

const logger = require('../Config/loggerConfig');
const { removeCache } = require('../utils/commonFunctions');
const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const ctrl = require('../Modules/ImportSettings/controller');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ME = '6f0000000000000000000001';
const SOMEONE = '6f0000000000000000000002';
const PROJECT = '6f0000000000000000000a01';
const GUEST = 0;
const OWNER = 1;
const ADMIN = 2;
const MEMBER = 3;

const BASE_RULES = [
    'importProjectCategories', 'importHourlyMilestoneRange', 'importHourlyMilestoneWeeklyRange', 'importProjectPriorities',
    'importProjectMilestone', 'importCommonDateFormat', 'importCommonExtension', 'importCompanyUserStatus', 'importCompanyRules',
    'importCompanyRoles', 'importCurrency', 'importProjectTabComponents', 'importProjectApps', 'importTaskStatusTemplate',
    'importTaskTypeTemplate', 'createDefaultMainChats', 'importProjectStatusTemplate', 'importTaskDefaultStatus',
    'importProjectStatus', 'importStatusType', 'importCompanyDesignations', 'importProjectSkills',
];

const importer = (name) => require('../utils/data')[name];
const ran = () => Object.entries(mockImports.fns).filter(([, fn]) => fn.mock.calls.length).map(([name]) => name);

const reply = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};
const signedIn = (over = {}) => ({ uid: ME, aud: COMPANY, headers: { companyid: COMPANY }, body: {}, query: {}, params: {}, ...over });
const signedOut = (over = {}) => ({ headers: { companyid: COMPANY }, body: {}, query: {}, params: {}, ...over });
const otherCompany = (over = {}) => signedIn({ aud: OTHER_COMPANY, ...over });
const flush = () => new Promise((resolve) => setImmediate(resolve));

let errorSpy;
beforeEach(() => {
    jest.clearAllMocks();
    Object.values(mockImports.fns).forEach((fn) => fn.mockReset().mockResolvedValue(undefined));
    getRoleType.mockReset();
    evaluatePermission.mockReset();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    jest.useRealTimers();
    errorSpy.mockRestore();
});

const runImport = async (fn, body) => {
    jest.useFakeTimers();
    const result = new Promise((resolve) => fn({ body }, resolve));
    for (let i = 0; i < 12; i++) await jest.advanceTimersByTimeAsync(250);
    const answer = await result;
    jest.useRealTimers();
    return answer;
};

describe.each([
    ['importSettingsFunction', () => ctrl.importSettingsFunction],
    ['importSettingsV2Function', () => ctrl.importSettingsV2Function],
])('%s validation', (_name, fn) => {
    it.each([[undefined], ['']])('asks for a company id when it is %j and imports nothing', async (companyId) => {
        const answer = await runImport(fn(), { companyId, uid: ME, email: 'a@x.io' });
        expect(answer).toEqual({ status: false, statusText: 'Company id is required.' });
        expect(ran()).toEqual([]);
    });

    it.each([[undefined], ['']])('asks for an email when the owner row is imported and it is %j', async (email) => {
        const answer = await runImport(fn(), { companyId: COMPANY, uid: ME, email });
        expect(answer).toEqual({ status: false, statusText: 'Email id is required.' });
        expect(ran()).toEqual([]);
    });

    it.each([[undefined], ['']])('asks for a user id when notifications are imported and it is %j', async (uid) => {
        const answer = await runImport(fn(), { companyId: COMPANY, uid, email: 'a@x.io', rules: ['importUserNotifications'] });
        expect(answer).toEqual({ status: false, statusText: 'User id is required.' });
        expect(ran()).toEqual([]);
    });

    it('does not ask for an email or user when the chosen rules need neither', async () => {
        const answer = await runImport(fn(), { companyId: COMPANY, rules: ['importCurrency'] });
        expect(answer.status).toBe(true);
    });

    it('writes the owner row for the given user into the given company', async () => {
        await runImport(fn(), { companyId: COMPANY, uid: ME, email: 'a@x.io', rules: ['importCompanyUserOwner'] });
        expect(importer('importCompanyUserOwner')).toHaveBeenCalledTimes(1);
        expect(importer('importCompanyUserOwner')).toHaveBeenCalledWith(COMPANY, {
            type: 'company_users',
            data: [
                { userId: ME },
                { $set: { companyId: COMPANY, userId: ME, isDelete: false, roleType: 1, status: 2, userEmail: 'a@x.io', designation: 0 } },
                { upsert: true },
            ],
        });
    });

    it('imports notifications for the given user into the given company', async () => {
        await runImport(fn(), { companyId: COMPANY, uid: ME, email: 'a@x.io', rules: ['importUserNotifications'] });
        expect(importer('importUserNotifications')).toHaveBeenCalledWith(COMPANY, ME);
        expect(ran()).toEqual(['importUserNotifications']);
    });

    it('ignores rule names it does not know', async () => {
        const answer = await runImport(fn(), { companyId: COMPANY, uid: ME, email: 'a@x.io', rules: ['dropEverything', 'importUserNotifications'] });
        expect(answer.status).toBe(true);
        expect(ran()).toEqual(['importUserNotifications']);
    });

    it('answers success without importing anything for an empty rule list', async () => {
        const answer = await runImport(fn(), { companyId: COMPANY, rules: [] });
        expect(answer).toEqual({ status: true, statusText: 'Settings has been imported successfully' });
        expect(ran()).toEqual([]);
    });

    it('clears the cached company users of that company after a successful import', async () => {
        await runImport(fn(), { companyId: COMPANY, uid: ME, email: 'a@x.io', rules: ['importUserNotifications'] });
        expect(removeCache).toHaveBeenCalledTimes(1);
        expect(removeCache).toHaveBeenCalledWith(`company_users:${COMPANY}`);
    });

    it('answers status false and leaves the cache alone when a rule fails', async () => {
        importer('importUserNotifications').mockRejectedValue(new Error('write failed'));
        const answer = await runImport(fn(), { companyId: COMPANY, uid: ME, email: 'a@x.io', rules: ['importUserNotifications'] });
        expect(answer.status).toBe(false);
        expect(removeCache).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalled();
    });

    it.failing('names the failure when a rule fails (the reason is read from a misspelt error.messge)', async () => {
        importer('importUserNotifications').mockRejectedValue(new Error('write failed'));
        const answer = await runImport(fn(), { companyId: COMPANY, uid: ME, email: 'a@x.io', rules: ['importUserNotifications'] });
        expect(answer.statusText).toEqual(expect.any(String));
    });

    it.failing('names the problem when rules is not a list (the reason is read from a misspelt error.messge)', async () => {
        const answer = await runImport(fn(), { companyId: COMPANY, uid: ME, email: 'a@x.io', rules: null });
        expect(answer.status).toBe(false);
        expect(answer.statusText).toEqual(expect.any(String));
    });
});

describe('importSettingsFunction rule selection', () => {
    it('imports every company-wide rule, each for the given company, when no rules are named', async () => {
        const answer = await runImport(ctrl.importSettingsFunction, { companyId: COMPANY, uid: ME, email: 'a@x.io' });
        expect(answer.status).toBe(true);
        expect(ran().sort()).toEqual([...BASE_RULES, 'importUserNotifications', 'importCompanyUserOwner'].sort());
        BASE_RULES.forEach((name) => expect(importer(name)).toHaveBeenCalledWith(COMPANY));
    });

    it('leaves out the owner row and notifications for a backend call, which needs no user or email', async () => {
        const answer = await runImport(ctrl.importSettingsFunction, { companyId: COMPANY, isFromBackend: true });
        expect(answer.status).toBe(true);
        expect(ran().sort()).toEqual([...BASE_RULES].sort());
    });

    it('does not let a backend call write the owner row or notifications even when named', async () => {
        const answer = await runImport(ctrl.importSettingsFunction, { companyId: COMPANY, isFromBackend: true, rules: ['importCompanyUserOwner', 'importUserNotifications', 'importCurrency'] });
        expect(answer.status).toBe(true);
        expect(ran()).toEqual(['importCurrency']);
    });

    it('imports only the named rules', async () => {
        await runImport(ctrl.importSettingsFunction, { companyId: COMPANY, rules: ['importCurrency', 'importStatusType'] });
        expect(ran().sort()).toEqual(['importCurrency', 'importStatusType']);
    });

    it('answers status false and runs no later batch when a rule of an early batch fails', async () => {
        importer('importProjectCategories').mockRejectedValue(new Error('boom'));
        const answer = await runImport(ctrl.importSettingsFunction, { companyId: COMPANY, isFromBackend: true });
        expect(answer.status).toBe(false);
        expect(ran()).not.toContain('importProjectSkills');
        expect(removeCache).not.toHaveBeenCalled();
    });
});

describe('importSettingsV2Function rule selection', () => {
    it('imports only the owner row and notifications, whatever else is named', async () => {
        const answer = await runImport(ctrl.importSettingsV2Function, { companyId: COMPANY, uid: ME, email: 'a@x.io', rules: ['importCurrency', 'importCompanyUserOwner'] });
        expect(answer.status).toBe(true);
        expect(ran()).toEqual(['importCompanyUserOwner']);
    });

    it('imports both when no rules are named', async () => {
        await runImport(ctrl.importSettingsV2Function, { companyId: COMPANY, uid: ME, email: 'a@x.io' });
        expect(ran().sort()).toEqual(['importCompanyUserOwner', 'importUserNotifications']);
    });
});

describe('importSettings', () => {
    const asHandler = (req) => {
        const res = reply();
        return ctrl.importSettings(req, res).then(() => res);
    };

    it('answers 403 to a signed-out caller and asks nothing about roles', async () => {
        const res = await asHandler(signedOut({ body: { email: 'a@x.io' } }));
        expect(res.statusCode).toBe(403);
        expect(res.body.status).toBe(false);
        expect(getRoleType).not.toHaveBeenCalled();
        expect(ran()).toEqual([]);
    });

    it('answers 403 when the header names a company the token does not hold', async () => {
        const res = await asHandler(otherCompany({ body: { email: 'a@x.io' } }));
        expect(res.statusCode).toBe(403);
        expect(getRoleType).not.toHaveBeenCalled();
        expect(ran()).toEqual([]);
    });

    it('answers 403 when the header is not a company id', async () => {
        const res = await asHandler(signedIn({ headers: { companyid: 'nope' } }));
        expect(res.statusCode).toBe(403);
        expect(ran()).toEqual([]);
    });

    it.each([[GUEST], [MEMBER], [ADMIN], [null]])('answers 403 to roleType %s and imports nothing', async (roleType) => {
        getRoleType.mockResolvedValue(roleType);
        const res = await asHandler(signedIn({ body: { email: 'a@x.io' } }));
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ status: false, statusText: 'Only the company owner can re-import company settings.' });
        expect(ran()).toEqual([]);
    });

    it('imports the owner row for the caller, not for a user named in the body', async () => {
        getRoleType.mockResolvedValue(OWNER);
        const spy = jest.spyOn(ctrl, 'importSettingsFunction').mockImplementation((req, cb) => cb({ status: true }));
        const res = await asHandler(signedIn({ body: { uid: SOMEONE, email: 'a@x.io', rules: ['importCompanyUserOwner'] } }));
        expect(spy.mock.calls[0][0]).toEqual({ body: { companyId: COMPANY, uid: ME, email: 'a@x.io', rules: ['importCompanyUserOwner'] } });
        expect(res.body).toEqual({ status: true });
        spy.mockRestore();
    });

    it('answers 400-level validation text from the import when the email is missing', async () => {
        getRoleType.mockResolvedValue(OWNER);
        const res = await asHandler(signedIn({ body: {} }));
        expect(res.body).toEqual({ status: false, statusText: 'Email id is required.' });
    });

    it('answers with the status code of a failing role lookup', async () => {
        getRoleType.mockRejectedValue(Object.assign(new Error('db down'), { statusCode: 503 }));
        const res = await asHandler(signedIn());
        expect(res.statusCode).toBe(503);
        expect(res.body).toEqual({ status: false, statusText: 'db down' });
    });

    it('answers 500 when a role lookup fails without a status code', async () => {
        getRoleType.mockRejectedValue(new Error('db down'));
        expect((await asHandler(signedIn())).statusCode).toBe(500);
    });
});

describe('importTemplate', () => {
    const templates = [{ TemplateName: 'T', TemplateId: 't1', category: 'category' }];
    const asHandler = (req) => {
        const res = reply();
        return ctrl.importTemplate(req, res).then(() => res);
    };

    it('answers 403 to a signed-out caller and to a caller whose token lacks the company', async () => {
        expect((await asHandler(signedOut({ body: { templates } }))).statusCode).toBe(403);
        expect((await asHandler(otherCompany({ body: { templates } }))).statusCode).toBe(403);
        expect(getRoleType).not.toHaveBeenCalled();
        expect(importer('importSettingTemplate')).not.toHaveBeenCalled();
    });

    it.each([[GUEST], [MEMBER], [null]])('answers 403 to roleType %s', async (roleType) => {
        getRoleType.mockResolvedValue(roleType);
        const res = await asHandler(signedIn({ body: { templates } }));
        expect(res.statusCode).toBe(403);
        expect(res.body.statusText).toBe('Only an owner or admin can import templates.');
        expect(importer('importSettingTemplate')).not.toHaveBeenCalled();
    });

    it.each([[undefined], [null], [[]], ['templates'], [{ length: 1 }]])('answers status false for templates %j', async (list) => {
        getRoleType.mockResolvedValue(ADMIN);
        const res = await asHandler(signedIn({ body: { templates: list } }));
        expect(res.body).toEqual({ status: false, statusText: 'template is required.' });
        expect(importer('importSettingTemplate')).not.toHaveBeenCalled();
    });

    it('answers status false when the request has no body at all', async () => {
        getRoleType.mockResolvedValue(OWNER);
        const res = await asHandler(signedIn({ body: undefined }));
        expect(res.body.statusText).toBe('template is required.');
    });

    it('imports into the header company for an owner and relays the importer answer', async () => {
        getRoleType.mockResolvedValue(OWNER);
        importer('importSettingTemplate').mockImplementation((companyId, list, cb) => cb({ status: true, statusText: 'done' }));
        const res = await asHandler(signedIn({ body: { companyId: OTHER_COMPANY, templates } }));
        expect(getRoleType).toHaveBeenCalledWith(COMPANY, ME);
        expect(importer('importSettingTemplate')).toHaveBeenCalledWith(COMPANY, templates, expect.any(Function));
        expect(res.body).toEqual({ status: true, statusText: 'done' });
    });

    it('answers 500 with the reason when the importer throws', async () => {
        getRoleType.mockResolvedValue(OWNER);
        importer('importSettingTemplate').mockImplementation(() => { throw new Error('bad template'); });
        const res = await asHandler(signedIn({ body: { templates } }));
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ status: false, statusText: 'bad template' });
    });
});

describe('importSettingsProjectFunction', () => {
    const asHandler = (req) => {
        const res = reply();
        return ctrl.importSettingsProjectFunction(req, res).then(() => res);
    };

    it('answers 403 to a signed-out caller and to a caller whose token lacks the company', async () => {
        expect((await asHandler(signedOut({ body: { type: 'project', projectId: PROJECT } }))).statusCode).toBe(403);
        expect((await asHandler(otherCompany({ body: { type: 'project', projectId: PROJECT } }))).statusCode).toBe(403);
        expect(getRoleType).not.toHaveBeenCalled();
        expect(importer('importCompanyRules')).not.toHaveBeenCalled();
    });

    it.each([[GUEST], [MEMBER], [null]])('answers 403 to roleType %s for a company-wide import', async (roleType) => {
        getRoleType.mockResolvedValue(roleType);
        const res = await asHandler(signedIn({ body: {} }));
        expect(res.statusCode).toBe(403);
        expect(res.body.statusText).toBe('Only an owner or admin can re-import company rules.');
        expect(importer('importCompanyRules')).not.toHaveBeenCalled();
    });

    it('treats any type but "project" as a company-wide import needing an owner or admin', async () => {
        getRoleType.mockResolvedValue(MEMBER);
        const res = await asHandler(signedIn({ body: { type: 'Project', projectId: PROJECT } }));
        expect(res.statusCode).toBe(403);
        expect(evaluatePermission).not.toHaveBeenCalled();
    });

    it.each([[undefined], [''], ['abc'], [`${PROJECT}0`], [{ $ne: '' }]])('answers 400 for a project import with the project id %j', async (projectId) => {
        getRoleType.mockResolvedValue(OWNER);
        const res = await asHandler(signedIn({ body: { type: 'project', projectId } }));
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ status: false, statusText: 'A valid project id is required.' });
        expect(importer('importCompanyRules')).not.toHaveBeenCalled();
    });

    it('answers 403 to a guest for a project import without the security-permissions setting', async () => {
        getRoleType.mockResolvedValue(GUEST);
        evaluatePermission.mockResolvedValue(null);
        const res = await asHandler(signedIn({ body: { type: 'project', projectId: PROJECT } }));
        expect(res.statusCode).toBe(403);
        expect(res.body.statusText).toBe('You do not have permission to change project permissions.');
        expect(evaluatePermission).toHaveBeenCalledWith(COMPANY, ME, 'settings.settings_security_permissions');
        expect(importer('importCompanyRules')).not.toHaveBeenCalled();
    });

    it.each([[0], [false], [undefined]])('answers 403 when the member setting is %j', async (permission) => {
        getRoleType.mockResolvedValue(MEMBER);
        evaluatePermission.mockResolvedValue(permission);
        const res = await asHandler(signedIn({ body: { type: 'project', projectId: PROJECT } }));
        expect(res.statusCode).toBe(403);
    });

    it('lets an owner or admin import a project without looking up the setting', async () => {
        importer('importCompanyRules').mockResolvedValue(['r1']);
        for (const roleType of [OWNER, ADMIN]) {
            getRoleType.mockResolvedValue(roleType);
            const res = await asHandler(signedIn({ body: { type: 'project', projectId: PROJECT } }));
            expect(res.body).toEqual({ status: true, statusText: 'Settings has been imported successfully', data: ['r1'] });
        }
        expect(evaluatePermission).not.toHaveBeenCalled();
        expect(importer('importCompanyRules')).toHaveBeenCalledWith(COMPANY, 'project', PROJECT);
    });

    it('imports the company rules into the header company for an admin, whatever company the body names', async () => {
        getRoleType.mockResolvedValue(ADMIN);
        const res = await asHandler(signedIn({ body: { companyId: COMPANY, type: 'company' } }));
        expect(importer('importCompanyRules')).toHaveBeenCalledWith(COMPANY, 'company', undefined);
        expect(res.body.status).toBe(true);
    });

    it('answers 500 with the reason when the import fails, or the error status code when it has one', async () => {
        getRoleType.mockResolvedValue(OWNER);
        importer('importCompanyRules').mockRejectedValueOnce(new Error('write failed'));
        const failed = await asHandler(signedIn());
        expect(failed.statusCode).toBe(500);
        expect(failed.body).toEqual({ status: false, statusText: 'write failed' });

        importer('importCompanyRules').mockRejectedValueOnce(Object.assign(new Error('busy'), { statusCode: 409 }));
        expect((await asHandler(signedIn())).statusCode).toBe(409);
        expect(logger.error).toHaveBeenCalled();
    });

    it('answers with no body at all as a company-wide import', async () => {
        getRoleType.mockResolvedValue(MEMBER);
        const res = await asHandler(signedIn({ body: undefined }));
        expect(res.statusCode).toBe(403);
    });
});

describe('importSettingsNotification', () => {
    const asHandler = (req) => {
        const res = reply();
        ctrl.importSettingsNotification(req, res);
        return flush().then(() => res);
    };
    const own = (body, over = {}) => signedIn({ body, ...over });

    it.each([[undefined], ['']])('asks for a company id when it is %j', async (companyId) => {
        const res = await asHandler(own({ companyId, userId: ME }));
        expect(res.body).toEqual({ status: false, statusText: 'Company id is required.' });
        expect(importer('importUserNotifications')).not.toHaveBeenCalled();
    });

    it.each([[undefined], ['']])('asks for a user id when it is %j', async (userId) => {
        const res = await asHandler(own({ companyId: COMPANY, userId }));
        expect(res.body).toEqual({ status: false, statusText: 'User id is required.' });
        expect(importer('importUserNotifications')).not.toHaveBeenCalled();
    });

    it('answers 403 when the user is not the signed-in user', async () => {
        const res = await asHandler(own({ companyId: COMPANY, userId: SOMEONE }));
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ status: false, statusText: 'You can only import your own notification settings.' });
        expect(importer('importUserNotifications')).not.toHaveBeenCalled();
    });

    it('answers 403 to a signed-out caller', async () => {
        const res = await asHandler(signedOut({ body: { companyId: COMPANY, userId: ME } }));
        expect(res.statusCode).toBe(403);
        expect(importer('importUserNotifications')).not.toHaveBeenCalled();
    });

    it('answers 403 when the body names a company other than the header company', async () => {
        const res = await asHandler(own({ companyId: OTHER_COMPANY, userId: ME }));
        expect(res.statusCode).toBe(403);
        expect(importer('importUserNotifications')).not.toHaveBeenCalled();
    });

    it('imports the caller\'s own notification settings into the header company', async () => {
        const res = await asHandler(own({ companyId: COMPANY, userId: ME }));
        expect(importer('importUserNotifications')).toHaveBeenCalledWith(COMPANY, ME);
        expect(res.body).toEqual({ status: true, statusText: 'Notification Settings has been imported successfully' });
    });

    it('answers status false with the reason when the import rejects', async () => {
        importer('importUserNotifications').mockRejectedValue('write failed');
        const res = await asHandler(own({ companyId: COMPANY, userId: ME }));
        expect(res.body).toEqual({ status: false, statusText: 'write failed' });
        expect(logger.error).toHaveBeenCalled();
    });

    it('answers status false when the request has no body at all', async () => {
        const res = await asHandler(own(undefined));
        expect(res.body.status).toBe(false);
    });
});
