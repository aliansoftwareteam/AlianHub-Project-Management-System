const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../../Config/loggerConfig');
const { myCache } = require('../../Config/config');
const { state } = require('../../Config/instanceState');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { version: appVersion, repository } = require('../../package.json');
const settings = require('../../Config/instanceSettings');
const { GROUPS, validateSettings } = require('./settingsCatalog');
const { PROBES, STORAGE_ROOT } = require('./probes');
const { checkDb, withTimeout } = require('./health');
const logs = require('./logsPath');
const backups = require('./backups');
const socketEmitter = require('../../event/socketEventEmitter');

const PUBLIC_CONFIG_KEY = 'instance:public-config';
const LATEST_RELEASE_KEY = 'instance:latest-release';
const ok = (res, statusText, data) => res.send({ status: true, statusText, data });
const fail = (res, code, statusText, data) => res.status(code).send({ status: false, statusText, ...(data ? { data } : {}) });

exports.access = (req, res) => ok(res, 'Instance admin.', { allowed: true, via: req.instanceAdmin });

exports.getSettings = (req, res) => ok(res, 'Instance settings.', { groups: GROUPS, settings: settings.describe(), loaded: settings.isLoaded() });

exports.putSettings = async (req, res) => {
    const { values, errors, valid } = validateSettings(req.body || {});
    if (!valid) return fail(res, 400, 'Some settings are not valid.', { errors });
    try {
        const result = await settings.saveInstanceSettings(values, req.uid || req.instanceAdmin);
        myCache.del(PUBLIC_CONFIG_KEY);
        socketEmitter.emit('update', { module: 'instanceSettings', event: 'INSTANCE_SETTINGS_UPDATED', keys: result.applied });
        return ok(res, result.restartRequired.length ? 'Saved. Restart the server to apply the marked settings.' : 'Saved.', { ...result, settings: settings.describe() });
    } catch (error) {
        logger.error(`instance settings save failed: ${error.message}`);
        return fail(res, 500, error.message);
    }
};

const unmask = (values = {}) => Object.fromEntries(Object.entries(values).filter(([, v]) => !(v && typeof v === 'object')));

exports.testSettings = async (req, res) => {
    const group = String(req.body?.group || '');
    const probe = PROBES[group];
    if (!probe) return fail(res, 400, `Nothing to test for "${group}". Try mail, storage or ai.`);
    const result = await probe(unmask(req.body?.values));
    return res.send({ ...result, data: { group, ...(result.data || {}) } });
};

exports.publicConfig = (req, res) => {
    let payload = myCache.get(PUBLIC_CONFIG_KEY);
    if (!payload) {
        payload = settings.publicConfig();
        myCache.set(PUBLIC_CONFIG_KEY, payload, 60);
    }
    return ok(res, 'Public config.', payload);
};

async function agendaCounts() {
    if ((process.env.AUTOMATION_QUEUE_DRIVER || 'agenda') === 'inline') return { driver: 'inline' };
    try {
        const { handleConnection } = require('../../middlewares/mongoConnector/mongoConnection');
        const db = (await withTimeout(handleConnection('global'), 3000, 'agenda')).database.db.collection('automation_jobs');
        const [pending, failed] = await Promise.all([
            db.countDocuments({ nextRunAt: { $ne: null }, lockedAt: null }),
            db.countDocuments({ failedAt: { $ne: null } }),
        ]);
        return { driver: 'agenda', pending, failed };
    } catch (error) {
        return { driver: 'agenda', error: error.message };
    }
}

async function storageHealth() {
    const type = process.env.STORAGE_TYPE || 'server';
    const probe = await PROBES.storage();
    const out = { type, ok: probe.status, detail: probe.statusText };
    if (type === 'server' && probe.status && fs.statfs) {
        try {
            const s = await fs.promises.statfs(STORAGE_ROOT);
            out.freeBytes = Number(s.bavail) * Number(s.bsize);
            out.totalBytes = Number(s.blocks) * Number(s.bsize);
        } catch (e) { /* free space is a nicety */ }
    }
    return out;
}

function mailHealth() {
    const configured = Boolean(process.env.RESEND_API_KEY || process.env.NODEMAILER_HOST);
    return { configured, provider: process.env.RESEND_API_KEY ? 'resend' : process.env.NODEMAILER_HOST ? 'smtp' : null };
}

exports.health = async (req, res) => {
    const probeMail = String(req.query.probe || '') === 'mail';
    const migrations = require('../../migrations');
    const [db, storage, agenda, migrationStatus, mail] = await Promise.all([
        checkDb(), storageHealth(), agendaCounts(),
        migrations.migrationStatus(migrations.liveDeps()).catch((error) => ({ error: error.message, applied: [], pending: [], failed: [] })),
        probeMail ? PROBES.mail().then((r) => ({ ...mailHealth(), ok: r.status, detail: r.statusText })) : Promise.resolve(mailHealth()),
    ]);
    const backupList = backups.listBackups();
    const readiness = {
        mailConfigured: mail.configured,
        storageChosen: Boolean(process.env.STORAGE_TYPE),
        backupTaken: backupList.length > 0,
        httpsWebUrl: /^https:\/\//i.test(process.env.WEBURL || ''),
        migrationsClean: migrationStatus.pending.length === 0 && !state.migrationError,
    };
    return ok(res, 'Instance health.', {
        status: db.ok ? 'ok' : 'degraded',
        version: appVersion,
        nodeVersion: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        bootedAt: state.bootedAt,
        memoryRssBytes: process.memoryUsage().rss,
        maintenance: state.maintenance,
        db, storage, mail, agenda,
        cron: { enabled: process.env.CRON_ENABLED !== 'false', tz: process.env.CRON_TZ || 'UTC', jobs: state.cron },
        migrations: { applied: migrationStatus.applied.length, pending: migrationStatus.pending.map((m) => m.id), failed: migrationStatus.failed, error: state.migrationError },
        lastBackup: backupList[0] || null,
        readiness,
    });
};

exports.setMaintenance = (req, res) => {
    state.maintenance = req.body?.on === true || req.body?.on === 'true';
    return ok(res, state.maintenance ? 'Maintenance mode is on.' : 'Maintenance mode is off.', { maintenance: state.maintenance });
};

const semver = (v) => String(v || '0').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
const newerThan = (a, b) => { const [x, y] = [semver(a), semver(b)]; for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

function repoSlug() {
    const m = String(repository?.url || '').match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    return m ? `${m[1]}/${m[2]}` : null;
}

async function latestRelease() {
    const cached = myCache.get(LATEST_RELEASE_KEY);
    if (cached) return cached;
    const slug = repoSlug();
    if (!slug) return null;
    try {
        const { data } = await axios.get(`https://api.github.com/repos/${slug}/releases/latest`, {
            timeout: 8000, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AlianHub-Instance' },
        });
        const release = { version: String(data.tag_name || '').replace(/^v/, ''), url: data.html_url, publishedAt: data.published_at, name: data.name };
        myCache.set(LATEST_RELEASE_KEY, release, 6 * 3600);
        return release;
    } catch (error) {
        logger.error(`latest release lookup failed: ${error.message}`);
        myCache.set(LATEST_RELEASE_KEY, { error: error.message }, 600);
        return { error: error.message };
    }
}

function changelogNewerThan(current) {
    const changelog = require('../Changelog/controller');
    const file = path.join(__dirname, '..', '..', 'CHANGELOG.md');
    if (!fs.existsSync(file)) return [];
    return changelog.parseChangelog(fs.readFileSync(file, 'utf8')).map(changelog.withSelfHost).filter((r) => newerThan(r.version, current));
}

exports.upgrade = async (req, res) => {
    const migrations = require('../../migrations');
    const [latest, migrationStatus] = await Promise.all([
        latestRelease(),
        migrations.migrationStatus(migrations.liveDeps()).catch((error) => ({ error: error.message, applied: [], pending: [], failed: [] })),
    ]);
    const releases = changelogNewerThan(appVersion);
    const updateAvailable = Boolean(latest && latest.version && newerThan(latest.version, appVersion));
    return ok(res, 'Upgrade status.', {
        currentVersion: appVersion,
        latest,
        updateAvailable,
        releases,
        upgradeNeedsHands: releases.some((r) => r.selfHost?.upgradeNeeded || r.selfHost?.breaking),
        migrations: { ...migrationStatus, auto: process.env.MIGRATIONS_AUTO !== 'false', error: state.migrationError },
        docker: Boolean(process.env.ALIANHUB_DOCKER || fs.existsSync('/.dockerenv')),
    });
};

exports.runMigrations = async (req, res) => {
    try {
        const migrations = require('../../migrations');
        const result = await migrations.runMigrations(migrations.liveDeps());
        const status = await migrations.refreshMigrationState();
        state.migrationError = result.failed ? `${result.failed.id}: ${result.failed.error}` : null;
        return ok(res, result.failed ? `${result.failed.id} failed.` : `Applied ${result.applied.length}.`, { ...result, status });
    } catch (error) {
        return fail(res, 500, error.message);
    }
};

exports.listLogs = (req, res) => ok(res, 'Log files.', { dir: logs.LOG_DIR, files: logs.listLogFiles() });

exports.tailLog = async (req, res) => {
    const kind = String(req.query.file || 'error');
    if (!logs.KINDS.includes(kind)) return fail(res, 400, `file must be one of ${logs.KINDS.join(', ')}.`);
    const lines = Math.min(5000, Math.max(1, Number(req.query.lines) || 500));
    try {
        return ok(res, 'Log tail.', { kind, ...(await logs.readTail(kind, lines)) });
    } catch (error) {
        return fail(res, 500, error.message);
    }
};

exports.downloadLog = (req, res) => {
    const file = logs.resolveLogFile(req.query.name);
    if (!file) return fail(res, 404, 'No such log file.');
    return res.download(file, path.basename(file));
};

exports.createBackup = async (req, res) => {
    try {
        const result = await backups.createBackup({ includeFiles: req.body?.includeFiles === true || req.body?.includeFiles === 'true' });
        return ok(res, `Backup ${result.name} written.`, result);
    } catch (error) {
        logger.error(`backup failed: ${error.message}`);
        return fail(res, 500, error.message);
    }
};

exports.listBackups = (req, res) => ok(res, 'Backups.', { dir: backups.BACKUP_DIR, backups: backups.listBackups() });

exports.downloadBackup = (req, res) => {
    const file = backups.resolveBackup(req.params.name);
    if (!file || !fs.existsSync(file)) return fail(res, 404, 'No such backup.');
    return res.download(file, path.basename(file));
};

exports.backupManifest = async (req, res) => {
    const file = backups.resolveBackup(req.params.name);
    if (!file || !fs.existsSync(file)) return fail(res, 404, 'No such backup.');
    try {
        return ok(res, 'Backup manifest.', await backups.readManifest(file));
    } catch (error) {
        return fail(res, 400, `Could not read the backup: ${error.message}`);
    }
};

exports.restoreBackup = async (req, res) => {
    try {
        const result = await backups.restoreBackup({ name: req.params.name, confirm: String(req.body?.confirm || '') });
        return ok(res, 'Restore finished.', result);
    } catch (error) {
        logger.error(`restore failed: ${error.message}`);
        return fail(res, error.message.includes('confirm') || error.message.includes('No such') ? 400 : 500, error.message);
    }
};

exports.deleteBackup = (req, res) => {
    try {
        backups.deleteBackup(req.params.name);
        return ok(res, 'Backup deleted.', { name: req.params.name });
    } catch (error) {
        return fail(res, 404, error.message);
    }
};

exports.stats = async (req, res) => {
    try {
        const [companies, users] = await Promise.all([
            MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{}] }, 'countDocuments'),
            MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{}] }, 'countDocuments'),
        ]);
        return ok(res, 'Instance stats.', { version: appVersion, nodeVersion: process.version, uptimeSeconds: Math.round(process.uptime()), companies: companies || 0, users: users || 0 });
    } catch (error) {
        return fail(res, 500, error.message);
    }
};

exports.companies = async (req, res) => {
    try {
        const rows = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.COMPANIES, data: [{}, 'Cst_CompanyName createdAt', { sort: { createdAt: -1 }, limit: 500 }],
        }, 'find');
        return ok(res, 'Companies fetched.', rows || []);
    } catch (error) {
        return fail(res, 500, error.message);
    }
};

const csvCell = (value) => {
    const text = String(value === null || value === undefined ? '' : value).replace(/<[^>]+>/g, '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

exports.auditExport = async (req, res) => {
    try {
        const companyId = String(req.query?.companyId || req.headers['companyid'] || '');
        if (!/^[a-f0-9]{24}$/i.test(companyId)) return fail(res, 400, 'companyId is required.');
        const filter = {};
        const from = req.query?.from ? new Date(req.query.from) : null;
        const to = req.query?.to ? new Date(req.query.to) : null;
        if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) return fail(res, 400, 'from/to must be valid dates.');
        if (from || to) {
            filter.createdAt = {};
            if (from) filter.createdAt.$gte = from;
            if (to) filter.createdAt.$lte = to;
        }
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.HISTORY,
            data: [filter, 'Type Key UserId ProjectId TaskId Message createdAt', { sort: { createdAt: -1 }, limit: 50000 }],
        }, 'find');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="audit-${companyId}.csv"`);
        const lines = ['CreatedAt,Type,Key,UserId,ProjectId,TaskId,Message'];
        (rows || []).forEach((row) => {
            lines.push([row.createdAt ? new Date(row.createdAt).toISOString() : '', row.Type, row.Key, row.UserId, row.ProjectId, row.TaskId, row.Message].map(csvCell).join(','));
        });
        return res.send('﻿' + lines.join('\r\n'));
    } catch (error) {
        return fail(res, 500, error.message);
    }
};
