const mockStorage = jest.fn();
const mockImport = jest.fn();
const mockMail = jest.fn();
const mockWrite = jest.fn();
const mockUnlink = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/config', () => ({ NODE_ENV: 'test', ERRORRECIVEREMAIL: 'ops@example.com' }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Company/controller.js', () => ({ importSettingsFun: (...a) => mockImport(...a) }));
jest.mock('../Modules/Auth/controller/helper.js', () => ({}));
jest.mock('../Modules/service.js', () => ({ sendAttachMail: (...a) => mockMail(...a) }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), writeFileSync: (...a) => mockWrite(...a), unlinkSync: (...a) => mockUnlink(...a) }));
jest.mock('../common-storage/common-unit.js', () => ({ handleCreateCompanyDataStorageFun: (...a) => mockStorage(...a) }), { virtual: true });

process.env.STORAGE_TYPE = 'unit';

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const logger = require('../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Company/controller2');

const NEW_ID = '6f0000000000000000000c09';
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

const dbReturns = ({ existing = [], saved = { _id: NEW_ID }, saveError, updateError, findError } = {}) => {
    MongoDbCrudOpration.mockImplementation(async (scope, obj, method) => {
        if (method === 'find') {
            if (findError) throw findError;
            return existing;
        }
        if (method === 'save') {
            if (saveError) throw saveError;
            return saved;
        }
        if (method === 'findOneAndUpdate') {
            if (updateError) throw updateError;
            return {};
        }
        return null;
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.mockResolvedValue({});
    mockImport.mockResolvedValue({});
    mockMail.mockImplementation((s, h, to, files, cb) => cb({ status: true }));
    dbReturns();
});

describe('setUpPreDefineCompanies', () => {
    it('saves an unavailable placeholder company in the global scope, sets it up, then marks it available', async () => {
        await ctrl.setUpPreDefineCompanies();

        const calls = MongoDbCrudOpration.mock.calls;
        expect(calls[0]).toEqual(['global', { type: SCHEMA_TYPE.PRECOMPANIES, data: { isAvailable: false, pickupCount: 0 } }, 'save']);
        expect(mockStorage).toHaveBeenCalledWith({}, NEW_ID);
        expect(mockImport).toHaveBeenCalledWith({ companyId: NEW_ID });
        expect(calls[1]).toEqual(['global', {
            type: SCHEMA_TYPE.PRECOMPANIES,
            data: [{ _id: NEW_ID }, { isAvailable: true, pickupCount: 0 }],
        }, 'findOneAndUpdate']);
    });

    it('reads the new id from a document that serialises to JSON', async () => {
        dbReturns({ saved: { toJSON: () => ({ _id: 'from-json' }), _id: 'raw' } });
        await ctrl.setUpPreDefineCompanies();
        expect(mockImport).toHaveBeenCalledWith({ companyId: 'from-json' });
    });

    it('rejects and never marks the company available when storage setup fails', async () => {
        mockStorage.mockRejectedValue(new Error('bucket denied'));
        await expect(ctrl.setUpPreDefineCompanies()).rejects.toBeUndefined();
        expect(MongoDbCrudOpration.mock.calls.map((c) => c[2])).toEqual(['save']);
    });

    it('rejects and never marks the company available when the settings import fails', async () => {
        mockImport.mockRejectedValue(new Error('import broke'));
        await expect(ctrl.setUpPreDefineCompanies()).rejects.toBeUndefined();
        expect(MongoDbCrudOpration.mock.calls.map((c) => c[2])).toEqual(['save']);
    });

    it('rejects with the database error when the placeholder cannot be saved', async () => {
        const failure = new Error('db down');
        dbReturns({ saveError: failure });
        await expect(ctrl.setUpPreDefineCompanies()).rejects.toBe(failure);
        expect(mockStorage).not.toHaveBeenCalled();
        expect(mockImport).not.toHaveBeenCalled();
    });

    it('rejects with the database error when marking the company available fails', async () => {
        const failure = new Error('update failed');
        dbReturns({ updateError: failure });
        await expect(ctrl.setUpPreDefineCompanies()).rejects.toBe(failure);
    });

    it('rejects when the save returns nothing to read an id from', async () => {
        dbReturns({ saved: null });
        await expect(ctrl.setUpPreDefineCompanies()).rejects.toBeInstanceOf(Error);
        expect(mockImport).not.toHaveBeenCalled();
    });
});

describe('preCompanySetup', () => {
    let setUp;
    beforeEach(() => {
        setUp = jest.spyOn(ctrl, 'setUpPreDefineCompanies').mockResolvedValue();
    });
    afterEach(() => setUp.mockRestore());

    it('counts the available placeholders in the global scope', async () => {
        dbReturns({ existing: [{}, {}, {}] });
        ctrl.preCompanySetup(3);
        await flush();
        expect(MongoDbCrudOpration).toHaveBeenCalledWith('global', { type: SCHEMA_TYPE.PRECOMPANIES, data: [{ isAvailable: true, pickupCount: 0 }] }, 'find');
    });

    it('creates nothing when enough placeholders are already available', async () => {
        dbReturns({ existing: [{}, {}, {}] });
        ctrl.preCompanySetup(3);
        await flush();
        expect(setUp).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('No need to setup pre-companies as already 3'));
    });

    it('creates only the missing number', async () => {
        dbReturns({ existing: [{}] });
        ctrl.preCompanySetup(4);
        await flush();
        expect(setUp).toHaveBeenCalledTimes(3);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('3 preset company Created'));
    });

    it('defaults to ten placeholders when no number is given', async () => {
        dbReturns({ existing: [] });
        ctrl.preCompanySetup();
        await flush();
        expect(setUp).toHaveBeenCalledTimes(10);
    });

    it('also defaults to ten for zero, which is falsy', async () => {
        dbReturns({ existing: new Array(9).fill({}) });
        ctrl.preCompanySetup(0);
        await flush();
        expect(setUp).toHaveBeenCalledTimes(1);
    });

    it('logs the lookup failure and creates nothing', async () => {
        dbReturns({ findError: new Error('no connection') });
        ctrl.preCompanySetup(2);
        await flush();
        expect(setUp).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith('Error Get PreCompanies:: no connection');
    });

    it('stops creating after the first failure and mails the collected errors', async () => {
        setUp.mockRestore();
        mockStorage.mockRejectedValue(new Error('bucket denied'));
        dbReturns({ existing: [] });
        ctrl.preCompanySetup(3);
        await flush();

        expect(mockStorage).toHaveBeenCalledTimes(1);
        const written = JSON.parse(mockWrite.mock.calls[0][1]);
        expect(mockWrite.mock.calls[0][0]).toBe('errorInSetPreCompanies.json');
        expect(written[0].type).toBe('Import Setting And Wasabi Error');
        expect(mockMail).toHaveBeenCalledWith(
            'PreCompanies Set Error',
            expect.stringContaining('test'),
            'ops@example.com',
            [{ filename: 'errorInSetPreCompanies.json', path: 'errorInSetPreCompanies.json' }],
            expect.any(Function),
        );
        expect(mockUnlink).toHaveBeenCalledWith('errorInSetPreCompanies.json');
    });

    it('keeps the error file and logs when the error mail cannot be sent', async () => {
        setUp.mockRestore();
        mockStorage.mockRejectedValue(new Error('bucket denied'));
        mockMail.mockImplementation((s, h, to, files, cb) => cb({ status: false, statusText: 'smtp down' }));
        dbReturns({ existing: [] });
        ctrl.preCompanySetup(1);
        await flush();

        expect(logger.error).toHaveBeenCalledWith('Pre Companies Error Mail Send Error : smtp down');
        expect(mockUnlink).not.toHaveBeenCalled();
    });

    it('does not mail anything when every placeholder was created', async () => {
        dbReturns({ existing: [] });
        ctrl.preCompanySetup(2);
        await flush();
        expect(mockMail).not.toHaveBeenCalled();
        expect(mockWrite).not.toHaveBeenCalled();
    });
});

describe('sendEmail', () => {
    it('mails the attachments to the configured error address and hands back the mail result', () => {
        const files = [{ filename: 'a.json', path: 'a.json' }];
        const cb = jest.fn();
        mockMail.mockImplementation((s, h, to, f, done) => done({ status: true, statusText: 'sent' }));
        ctrl.sendEmail(files, cb);
        expect(mockMail).toHaveBeenCalledWith('PreCompanies Set Error', expect.any(String), 'ops@example.com', files, expect.any(Function));
        expect(cb).toHaveBeenCalledWith({ status: true, statusText: 'sent' });
    });
});
