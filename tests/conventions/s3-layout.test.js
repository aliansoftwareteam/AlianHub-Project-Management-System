/* Which bucket and key a file lands in is decided in one place, common-storage/s3Layout.js, so a hosted
 * instance (one shared bucket, a prefix of its own) can never write outside its prefix by a call site that
 * still names `Bucket: companyId`. The S3 client is built in one place too, so a rotated key reaches every caller. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SERVER_CODE = ['Modules', 'Config', 'utils', 'common-storage', 'middlewares', 'event', 'socket', 'scripts', 'migrations', 'index.js', 'server.js', 'cron.js'];
const LAYOUT = 'common-storage/s3Layout.js';
const CLIENT_FACTORY = 'common-storage/s3Client.js';

const filesUnder = (target) => {
    if (!fs.existsSync(target)) return [];
    if (fs.statSync(target).isFile()) return target.endsWith('.js') ? [target] : [];
    return fs.readdirSync(target).filter((entry) => entry !== 'node_modules').flatMap((entry) => filesUnder(path.join(target, entry)));
};

const sources = SERVER_CODE.flatMap((entry) => filesUnder(path.join(ROOT, entry)))
    .map((file) => ({ file: path.relative(ROOT, file).split(path.sep).join('/'), text: fs.readFileSync(file, 'utf8') }));

const linesMatching = (pattern, except) => sources
    .filter(({ file }) => file !== except)
    .flatMap(({ file, text }) => text.split('\n').map((line, i) => (pattern.test(line) ? `${file}:${i + 1}: ${line.trim()}` : null)).filter(Boolean));

describe('object storage call sites', () => {
    it('read the server code they guard', () => {
        expect(sources.map(({ file }) => file)).toEqual(expect.arrayContaining([LAYOUT, CLIENT_FACTORY, 'common-storage/s3Store.js', 'Modules/storage/wasabi/controller.js']));
    });

    it('name a bucket only in the layout module', () => {
        expect(linesMatching(/\bBucket\s*:/, LAYOUT)).toEqual([]);
    });

    it('build an S3 client only in the client factory', () => {
        expect(linesMatching(/new\s+S3Client\s*\(/, CLIENT_FACTORY)).toEqual([]);
    });

    it('would catch a call site that names its own bucket', () => {
        const pattern = /\bBucket\s*:/;
        expect(pattern.test("await s3.send(new PutObjectCommand({ Bucket: companyId, Key: key }));")).toBe(true);
        expect(pattern.test('const { bucket } = layout;')).toBe(false);
    });
});
