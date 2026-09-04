const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const { EJSON } = require('bson');
const { buildManifest, validateManifest, staleCollections, isValidName, backupName, ENTRY_RX, readManifest, walkArchive, FORMAT } = require('../Modules/Instance/backups');

describe('the manifest', () => {
    it('records format, version, time, files flag, databases and companies', () => {
        const m = buildManifest({ includeFiles: true, databases: { global: ['users'], '6a8ee973d625fca52e519a12': ['tasks'] }, companies: [{ _id: '6a8ee973d625fca52e519a12', Cst_CompanyName: 'Acme' }], createdAt: new Date('2026-09-04T10:00:00Z'), version: '14.35.0' });
        expect(m).toEqual({
            format: FORMAT, formatVersion: 1, appVersion: '14.35.0', createdAt: '2026-09-04T10:00:00.000Z', includeFiles: true,
            databases: { global: ['users'], '6a8ee973d625fca52e519a12': ['tasks'] }, companies: [{ _id: '6a8ee973d625fca52e519a12', name: 'Acme' }],
        });
        expect(validateManifest(m)).toBeNull();
    });

    it('refuses foreign archives, newer formats and odd database names', () => {
        expect(validateManifest(null)).toMatch(/Not an AlianHub backup/);
        expect(validateManifest({ format: 'mongodump' })).toMatch(/Not an AlianHub backup/);
        expect(validateManifest({ format: FORMAT, formatVersion: 99, databases: {} })).toMatch(/newer/);
        expect(validateManifest({ format: FORMAT, formatVersion: 1, databases: { admin: [] } })).toMatch(/Unexpected database name "admin"/);
        expect(validateManifest({ format: FORMAT, formatVersion: 1 })).toMatch(/lists no databases/);
    });
});

describe('archive names and entries', () => {
    it('names archives after the app version and time, and only accepts that shape back', () => {
        const name = backupName('alianhub', new Date('2026-09-04T10:11:12Z'));
        expect(name).toMatch(/^alianhub-\d+\.\d+\.\d+-20260904-101112\.tar\.gz$/);
        expect(isValidName(name)).toBe(true);
        for (const bad of ['../etc/passwd', 'x.tar.gz', 'alianhub-1.0.0-20260904-101112.tar', 'alianhub-1.0.0-20260904-101112.tar.gz/../x']) expect(isValidName(bad)).toBe(false);
    });

    it('drops collections created after the backup so a restore leaves nothing newer behind', () => {
        expect(staleCollections(['tasks', 'notes', 'users'], ['users', 'tasks'])).toEqual(['notes']);
        expect(staleCollections(['users'], ['users', 'tasks'])).toEqual([]);
        expect(staleCollections([], [])).toEqual([]);
    });

    it('only restores collection files under global or a company id', () => {
        expect('global/users.jsonl'.match(ENTRY_RX).slice(1)).toEqual(['global', 'users']);
        expect('6a8ee973d625fca52e519a12/tasks.jsonl'.match(ENTRY_RX).slice(1)).toEqual(['6a8ee973d625fca52e519a12', 'tasks']);
        for (const bad of ['admin/users.jsonl', 'global/../x.jsonl', 'storage/a.jsonl', 'global/users.json']) expect(ENTRY_RX.test(bad)).toBe(false);
    });
});

describe('reading an archive back', () => {
    let dir; let file;
    beforeAll(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-backup-'));
        file = path.join(dir, 'alianhub-1.0.0-20260904-101112.tar.gz');
        const manifest = buildManifest({ databases: { global: ['users'] }, companies: [] });
        const archive = archiver('tar', { gzip: true });
        const out = fs.createWriteStream(file);
        const done = new Promise((resolve, reject) => { out.on('close', resolve); archive.on('error', reject); });
        archive.pipe(out);
        archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
        archive.append(`${EJSON.stringify({ _id: 1, email: 'a@b.co', at: new Date('2026-09-04T00:00:00Z') }, { relaxed: false })}\n`, { name: 'global/users.jsonl' });
        archive.append('hello', { name: 'storage/x/y.txt' });
        await archive.finalize();
        await done;
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('finds the manifest without reading the rest', async () => {
        const m = await readManifest(file);
        expect(m.format).toBe(FORMAT);
        expect(m.databases).toEqual({ global: ['users'] });
    });

    it('walks every entry in order and keeps EJSON types through the round trip', async () => {
        const seen = [];
        let doc;
        await walkArchive(file, async (header, stream) => {
            seen.push(header.name);
            const chunks = [];
            for await (const c of stream) chunks.push(c);
            if (header.name === 'global/users.jsonl') doc = EJSON.parse(Buffer.concat(chunks).toString('utf8').trim(), { relaxed: false });
            return true;
        });
        expect(seen).toEqual(['manifest.json', 'global/users.jsonl', 'storage/x/y.txt']);
        expect(doc.at).toBeInstanceOf(Date);
        expect(doc.email).toBe('a@b.co');
    });
});
