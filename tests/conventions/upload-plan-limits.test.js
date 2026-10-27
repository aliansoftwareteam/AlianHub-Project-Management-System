/* 064: no upload path may skip the plan's storage quota and largest file. Each way a file is
 * stored goes through one of the checked helpers; a new one fails here until it does too. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(rel);
    return entry.name.endsWith('.js') ? [rel] : [];
});

/* They read an upload and throw it away: nothing reaches storage. */
const PARSE_ONLY = new Set([
    'Modules/AI/transcribe.js',
    'Modules/AIProjectGenerator/briefExtractor.js',
    'Modules/AIProjectGenerator/controller.js',
    'Modules/Company/routes.js',
]);

const CHECKED = /\buploadRefusal\b|\bassertUploadAllowed\b|\bputLocalFile\b|\brequirePlanRoom\b/;
const MULTER = /require\(['"](?:multer|[./]*utils\/contextMulter)['"]\)/;

const functionBody = (source, name) => {
    const start = source.search(new RegExp(`(async function ${name}\\b|const ${name} = async)`));
    if (start < 0) return '';
    const open = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let at = open; at < source.length; at += 1) {
        if (source[at] === '{') depth += 1;
        if (source[at] === '}') depth -= 1;
        if (depth === 0) return source.slice(open, at + 1);
    }
    return '';
};

describe('uploads and the plan limits', () => {
    const sources = [...walk('Modules'), ...walk('common-storage')];

    it('every module that takes a multipart upload stores it only through a plan check', () => {
        const unchecked = sources.filter((rel) => MULTER.test(read(rel)) && !PARSE_ONLY.has(rel) && !CHECKED.test(read(rel)));
        expect(unchecked).toEqual([]);
    });

    it('the shared upload refusal asks the plan', () => {
        expect(functionBody(read('Modules/storage/bucketAccess.js'), 'uploadRefusal')).toMatch(/planRefusal\(/);
    });

    it('the writers outside the upload routes assert the plan before storing', () => {
        expect(functionBody(read('common-storage/putLocalFile.js'), 'putLocalFile')).toMatch(/assertUploadAllowed\(/);
        expect(functionBody(read('Modules/CloudStorage/controller.js'), 'storeImportedFile')).toMatch(/assertUploadAllowed\(/);
    });

    it('every upload and capture route carries a guard that reaches the plan', () => {
        const files = ['Modules/storage/server/routes.js', 'Modules/storage/wasabi/routes.js', 'Modules/LogTime/routes.js'];
        const routes = files.flatMap((rel) => read(rel).split('\n')
            .filter((line) => /app\.(post|put)\(\s*['"][^'"]*(upload|capture)/i.test(line))
            .map((line) => ({ rel, line: line.trim() })));
        expect(routes.length).toBeGreaterThanOrEqual(7);
        const unguarded = routes.filter(({ line }) => !/refuseUpload\(|validatePath|captureGuard|requirePlanRoom\(/.test(line));
        expect(unguarded).toEqual([]);
    });

    it('multer reads the largest file per request', () => {
        expect(read('utils/uploadConfig.js')).toMatch(/get fileSize\(\)/);
    });
});
