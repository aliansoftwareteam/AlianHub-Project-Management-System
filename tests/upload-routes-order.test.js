/* Every route that reads a file from a request, and what stands in front of the reading: a caller the route
 * refuses whatever the request holds is refused before a file is read. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER_DIRS = ['Modules', 'Config', 'utils', 'middlewares', 'common-storage', 'socket', 'event'];

const filesUnder = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []).flatMap((entry) => {
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : filesUnder(path.join(dir, entry.name));
    return entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : [];
});

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers.flat(); };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: () => {} };
jest.spyOn(console, 'log').mockImplementation(() => {});
filesUnder(path.join(ROOT, 'Modules')).filter((file) => path.basename(file) === 'routes.js').sort().forEach((file) => require(file).init(app));

const formUpload = require('../Modules/Forms/helpers/formUpload');
const pages = require('../Modules/Pages/controller');

/* The functions that read a file part: the upload library's own, and the three that wrap it to word its errors. */
const READERS = ['multerMiddleware', 'briefUploadMiddleware', 'uploadMiddleware'];
const readsAFile = (handler) => READERS.includes(handler.name) || handler === formUpload.parse || handler === pages.uploadImage;
const nameOf = (handler) => handler.refusesAs || handler.name || 'a guard';

/* [what stands in front of the reading, in its order; what is asked while the file is read or once it has been]. */
const TAKES_A_FILE = {
    'POST /api/v2/timetracker/capture': [['timelog.capture'], 'the bucket, the path and the person\'s own running timer, by the reader before it stores, and again after'],
    'POST /api/v3/timetracker/capture': [['timelog.capture'], 'the bucket, the path and the person\'s own running timer, by the reader before it stores, and again after'],
    'POST /api/v4/timetracker/capture': [['timelog.capture'], 'the bucket, the path and the person\'s own running timer, by the reader before it stores, and again after'],
    'POST /api/v1/wasabi/uploadFile': [[], 'the bucket and the path, by the reader before it stores, and again after'],
    'POST /api/v1/storage/uploadFile': [[], 'the bucket and the path, by the reader before it stores, and again after'],
    'POST /api/v2/company/create': [['workspace.create'], 'nothing: a file part is passed over'],
    'POST /api/v1/ai/project/upload-brief': [['ai.spend', 'briefAsked'], 'the company the fields name, after; the file is removed on a refusal'],
    'POST /api/v1/ai/transcribe': [['ai.spend'], 'the workspace\'s AI switch, after; the audio is held in memory and never stored'],
    'POST /api/v2/pages/:id/images': [['page.image'], 'the right to edit the doc, by the handler before it reads the file'],
    'POST /form/:token': [['a guard'], 'the link, after: a public form has no caller to ask; the files are removed on a refusal'],
};

describe('a route that reads a file from the request', () => {
    const found = Object.keys(routes).filter((route) => routes[route].some(readsAFile)).sort();

    it('is one of the routes listed here', () => {
        expect(found).toEqual(Object.keys(TAKES_A_FILE).sort());
    });

    it.each(Object.keys(TAKES_A_FILE))('%s has what refuses a caller outright in front of the reading', (route) => {
        const stack = routes[route];
        const before = stack.slice(0, stack.findIndex(readsAFile)).map(nameOf);

        expect(before).toEqual(TAKES_A_FILE[route][0]);
        expect(stack.slice(stack.findIndex(readsAFile) + 1).filter((handler) => handler.refusesAs)).toEqual([]);
    });

    it('is the only kind of route the upload library is loaded for', () => {
        const loaders = SERVER_DIRS.flatMap((dir) => filesUnder(path.join(ROOT, dir)))
            .filter((file) => /require\((['"])(multer|busboy|formidable|express-fileupload|multiparty)\1\)/.test(fs.readFileSync(file, 'utf8')))
            .map((file) => path.relative(ROOT, file)).sort();

        expect(loaders).toEqual([
            'Modules/AI/transcribe.js', 'Modules/AIProjectGenerator/briefExtractor.js', 'Modules/AIProjectGenerator/controller.js', 'Modules/Company/routes.js',
            'Modules/Forms/helpers/formUpload.js', 'Modules/LogTime/routes.js', 'Modules/Pages/helpers/pageImages.js',
            'Modules/storage/server/helpers/bucket.helper.js', 'Modules/storage/wasabi/routes.js',
        ]);
    });
});

describe('the size and the kind of file each of them takes', () => {
    const { DEFAULT_LIMITS, BLOCKED_EXTENSIONS } = require('../utils/uploadConfig');

    it('has a size limit on every reader', () => {
        expect(DEFAULT_LIMITS).toEqual({ fileSize: 100 * 1024 * 1024, files: 20 });
        expect(BLOCKED_EXTENSIONS.has('.exe')).toBe(true);
        expect(require('../Modules/AIProjectGenerator/briefExtractor').MAX_BRIEF_BYTES).toBe(10 * 1024 * 1024);
        expect([formUpload.MAX_FILE_BYTES, formUpload.MAX_FILES]).toEqual([10 * 1024 * 1024, 3]);
        expect(require('../utils/imageGuard').getLimits().MAX_BYTES).toBeGreaterThan(0);
    });
});
