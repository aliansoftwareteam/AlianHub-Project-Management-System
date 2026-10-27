/* STORAGE_TYPE=s3 is the provider-neutral name of the object-storage driver: the same routes, the same
 * uploads and the same reads as STORAGE_TYPE=wasabi, which keeps working, and server stays the local disk. */
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(), getCompanyDataFun: jest.fn() }));

const { isObjectStorage } = require('../common-storage/s3Config');
const { validateSettings } = require('../Modules/Instance/settingsCatalog');

describe('STORAGE_TYPE', () => {
    it('s3 loads the object-storage driver that wasabi always has', () => {
        const s3 = require('../common-storage/common-s3');
        expect(s3).toBe(require('../common-storage/common-wasabi'));
        expect(s3.currentDirectory).toBe('wasabi');
        expect(require('../common-storage/common-server').currentDirectory).toBe('server');
    });

    it('s3 and wasabi keep files in object storage, server on the local disk', () => {
        expect(isObjectStorage({ STORAGE_TYPE: 's3' })).toBe(true);
        expect(isObjectStorage({ STORAGE_TYPE: 'wasabi' })).toBe(true);
        expect(isObjectStorage({})).toBe(true);
        expect(isObjectStorage({ STORAGE_TYPE: 'server' })).toBe(false);
    });

    it('can be chosen as s3, wasabi or server in the console', () => {
        for (const value of ['s3', 'wasabi', 'server']) expect(validateSettings({ STORAGE_TYPE: value }).valid).toBe(true);
        expect(validateSettings({ STORAGE_TYPE: 'dropbox' }).errors).toEqual({ STORAGE_TYPE: 'option' });
    });
});
