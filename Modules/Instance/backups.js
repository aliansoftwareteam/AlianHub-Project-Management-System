const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const archiver = require('archiver');
const tar = require('tar-stream');
const { EJSON } = require('bson');
const { version: appVersion } = require('../../package.json');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { handleConnection } = require('../../middlewares/mongoConnector/mongoConnection');
const connectionRegistry = require('../../middlewares/mongoConnector/helper');
const { state } = require('../../Config/instanceState');
const { myCache } = require('../../Config/config');
const logger = require('../../Config/loggerConfig');
const { STORAGE_ROOT } = require('./probes');

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || 'backups');
const FORMAT = 'alianhub-backup';
const FORMAT_VERSION = 1;
const NAME_RX = /^[a-z0-9.-]+-\d{8}-\d{6}\.tar\.gz$/;
const DB_RX = /^(global|[a-f0-9]{24})$/;
const ENTRY_RX = /^(global|[a-f0-9]{24})\/([A-Za-z0-9_.-]+)\.jsonl$/;
const INSERT_BATCH = 500;

const stamp = (date = new Date()) => { const iso = date.toISOString(); return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`; };
const backupName = (prefix = 'alianhub', date = new Date()) => `${prefix}-${appVersion}-${stamp(date)}.tar.gz`.toLowerCase().replace(/[^a-z0-9.-]/g, '-');

/* Pure: what an archive says about itself, written first so a restore can read
 * it without unpacking the rest. */
function buildManifest({ includeFiles = false, databases = {}, companies = [], createdAt = new Date(), version = appVersion } = {}) {
    return {
        format: FORMAT,
        formatVersion: FORMAT_VERSION,
        appVersion: version,
        createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
        includeFiles: Boolean(includeFiles),
        databases,
        companies: companies.map((c) => ({ _id: String(c._id), name: c.Cst_CompanyName || '' })),
    };
}

/* Pure: refuses anything that is not one of our own archives. */
function validateManifest(manifest) {
    if (!manifest || manifest.format !== FORMAT) return 'Not an AlianHub backup.';
    if (Number(manifest.formatVersion) > FORMAT_VERSION) return `Backup format ${manifest.formatVersion} is newer than this version understands.`;
    if (!manifest.databases || typeof manifest.databases !== 'object') return 'The backup lists no databases.';
    const bad = Object.keys(manifest.databases).find((db) => !DB_RX.test(db));
    if (bad) return `Unexpected database name "${bad}" in the backup.`;
    return null;
}

const isValidName = (name) => NAME_RX.test(String(name || ''));
const resolveBackup = (name) => (isValidName(name) ? path.join(BACKUP_DIR, path.basename(name)) : null);

async function nativeDb(name) {
    const res = await handleConnection(name);
    return res.database.db;
}

async function listCollections(db) {
    const rows = await db.listCollections({}, { nameOnly: true }).toArray();
    return rows.map((r) => r.name).filter((n) => !n.startsWith('system.')).sort();
}

async function listCompanies() {
    return MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{}, { _id: 1, Cst_CompanyName: 1 }] }, 'find');
}

async function* jsonlOf(db, collection) {
    const cursor = db.collection(collection).find({});
    for await (const doc of cursor) yield `${EJSON.stringify(doc, { relaxed: false })}\n`;
}

async function createBackup({ includeFiles = false, prefix = 'alianhub' } = {}) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const companies = await listCompanies();
    const dbNames = ['global', ...companies.map((c) => String(c._id))];
    const databases = {};
    for (const name of dbNames) databases[name] = await listCollections(await nativeDb(name));
    const withFiles = includeFiles && (process.env.STORAGE_TYPE || 'server') === 'server' && fs.existsSync(STORAGE_ROOT);
    const manifest = buildManifest({ includeFiles: withFiles, databases, companies });

    const name = backupName(prefix);
    const file = path.join(BACKUP_DIR, name);
    const output = fs.createWriteStream(file);
    const archive = archiver('tar', { gzip: true, gzipOptions: { level: 6 } });
    const done = new Promise((resolve, reject) => {
        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
        archive.on('warning', (err) => logger.error(`backup warning: ${err.message}`));
    });
    archive.pipe(output);
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    for (const [dbName, collections] of Object.entries(databases)) {
        const db = await nativeDb(dbName);
        for (const collection of collections) {
            archive.append(Readable.from(jsonlOf(db, collection)), { name: `${dbName}/${collection}.jsonl` });
        }
    }
    if (withFiles) archive.directory(STORAGE_ROOT, 'storage');
    await archive.finalize();
    await done;
    const { size } = fs.statSync(file);
    logger.info(`backup written: ${name} (${size} bytes)`);
    return { name, size, manifest };
}

function listBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
        .filter(isValidName)
        .map((name) => { const s = fs.statSync(path.join(BACKUP_DIR, name)); return { name, size: s.size, createdAt: s.mtime }; })
        .sort((a, b) => b.createdAt - a.createdAt);
}

/* Walks a .tar.gz entry by entry; `onEntry(header, stream)` must consume the
 * stream. Returning false stops the walk early (used to read the manifest only). */
function walkArchive(file, onEntry) {
    return new Promise((resolve, reject) => {
        const extract = tar.extract();
        const input = fs.createReadStream(file);
        let stopped = false;
        const fail = (error) => { if (!stopped) { stopped = true; input.destroy(); reject(error); } };
        extract.on('entry', (header, stream, next) => {
            if (stopped) { stream.resume(); return next(); }
            Promise.resolve(onEntry(header, stream)).then((keepGoing) => {
                if (keepGoing === false) { stopped = true; input.destroy(); resolve(); return; }
                next();
            }).catch(fail);
        });
        extract.on('finish', () => { if (!stopped) resolve(); });
        extract.on('error', fail);
        input.on('error', fail);
        input.pipe(zlib.createGunzip()).on('error', fail).pipe(extract);
    });
}

async function readAll(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
}

async function readManifest(file) {
    let manifest = null;
    await walkArchive(file, async (header, stream) => {
        if (header.name === 'manifest.json') { manifest = JSON.parse(await readAll(stream)); return false; }
        stream.resume();
        return true;
    });
    return manifest;
}

async function restoreCollection(db, collection, stream, counters) {
    const target = db.collection(collection);
    try { await target.drop(); } catch (error) { if (error.codeName !== 'NamespaceNotFound') throw error; }
    let pending = '';
    let batch = [];
    const flush = async () => { if (batch.length) { await target.insertMany(batch, { ordered: false }); counters.documents += batch.length; batch = []; } };
    for await (const chunk of stream) {
        pending += chunk.toString('utf8');
        let cut;
        while ((cut = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, cut);
            pending = pending.slice(cut + 1);
            if (line.trim()) batch.push(EJSON.parse(line, { relaxed: false }));
            if (batch.length >= INSERT_BATCH) await flush();
        }
    }
    if (pending.trim()) batch.push(EJSON.parse(pending, { relaxed: false }));
    await flush();
    counters.collections += 1;
}

async function restoreFile(relative, stream) {
    const target = path.resolve(STORAGE_ROOT, relative);
    if (!target.startsWith(STORAGE_ROOT + path.sep)) { stream.resume(); return false; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await new Promise((resolve, reject) => stream.pipe(fs.createWriteStream(target)).on('finish', resolve).on('error', reject));
    return true;
}

function resetMongoConnections() {
    for (const entry of connectionRegistry.connections.splice(0)) {
        try { entry.connection.close(); } catch (e) { /* already closed */ }
    }
}

/* Destructive by design: every collection named in the archive is dropped and
 * refilled. The caller has typed the archive name, a safety backup is taken
 * first, and the API answers 503 to everyone else until it is over. */
async function restoreBackup({ name, confirm }) {
    const file = resolveBackup(name);
    if (!file || !fs.existsSync(file)) throw new Error('No such backup.');
    if (confirm !== name) throw new Error('Type the backup name to confirm the restore.');
    const manifest = await readManifest(file);
    const problem = validateManifest(manifest);
    if (problem) throw new Error(problem);

    const safety = await createBackup({ includeFiles: false, prefix: 'pre-restore' });
    state.maintenance = true;
    const counters = { databases: 0, collections: 0, documents: 0, files: 0 };
    try {
        const dbs = new Map();
        const dbFor = async (dbName) => { if (!dbs.has(dbName)) { dbs.set(dbName, await nativeDb(dbName)); counters.databases += 1; } return dbs.get(dbName); };
        await walkArchive(file, async (header, stream) => {
            const entry = header.name.match(ENTRY_RX);
            if (entry && manifest.databases[entry[1]]) {
                await restoreCollection(await dbFor(entry[1]), entry[2], stream, counters);
            } else if (manifest.includeFiles && header.type === 'file' && header.name.startsWith('storage/')) {
                if (await restoreFile(header.name.slice('storage/'.length), stream)) counters.files += 1;
            } else {
                stream.resume();
            }
            return true;
        });
        myCache.flushAll();
        resetMongoConnections();
        const migrations = require('../../migrations');
        const run = await migrations.runMigrations(migrations.liveDeps());
        await migrations.refreshMigrationState();
        require('../Setup/controller').resetInstalledFlag();
        return { restored: counters, safetyBackup: safety.name, migrations: run };
    } finally {
        state.maintenance = false;
    }
}

function deleteBackup(name) {
    const file = resolveBackup(name);
    if (!file || !fs.existsSync(file)) throw new Error('No such backup.');
    fs.unlinkSync(file);
}

module.exports = {
    BACKUP_DIR, FORMAT, FORMAT_VERSION, NAME_RX, ENTRY_RX, backupName, buildManifest, validateManifest, isValidName, resolveBackup,
    createBackup, listBackups, readManifest, walkArchive, restoreBackup, deleteBackup, resetMongoConnections,
};
