/* The Drive/Dropbox attachment picker on the connectors module (076, FR-39/40).
 *
 * The person is always the session (`req.uid`), never a field of the request, so no route can get a token, a
 * preview or an import for anyone but the caller (FR-40). An API token holds no personal connection, and a guest
 * or a removed member has no seat. Picking and importing use each person's own module connection; connecting is
 * done once on Connectors (072), not here.
 *
 * Downloads for "import a copy" go through a controlled axios with the owner's own connection token and an
 * explicit host, not the agent egress path: they stream whole files (up to MAX_IMPORT_BYTES) rather than the
 * small, redirect-free JSON an agent tool reads, and they are a person's own action, not an AI call. The one
 * client-supplied URL (the Dropbox Chooser's direct link) is matched against a host allow-list to stop SSRF. */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { tenantOf, TenantError } = require('../../Config/tenant');
const { getRoleType } = require('../../Config/permissionGuard');
const { ROLE_GUEST } = require('../../Config/roleTypes');
const logger = require('../../Config/loggerConfig');
const { requestAddress } = require('../../utils/requestAddress');
const { UPLOAD, changeVerdict } = require('../storage/changeScope');
const apps = require('./apps');
const connections = require('./resolveConnection');
const P = require('./pickerProviders');

const LOG = '[connectors:picker]';
const MAX_IMPORT_BYTES = Number(process.env.CLOUD_STORAGE_MAX_IMPORT_BYTES || 100 * 1024 * 1024);

const refuse = (res, code, statusText, extra = {}) => res.status(code).send({ status: false, statusText, ...extra });

const personOrRefuse = async (req, res) => {
    let companyId;
    try {
        companyId = tenantOf(req);
    } catch (error) {
        if (!(error instanceof TenantError)) throw error;
        refuse(res, error.statusCode, error.message);
        return null;
    }
    if (req.apiToken) { refuse(res, 403, 'An API token cannot use the attachment picker.'); return null; }
    const role = await getRoleType(companyId, req.uid);
    if (role === null || role === undefined || role === ROLE_GUEST) { refuse(res, 403, 'Only a member of this workspace can pick a file.'); return null; }
    return { companyId, userId: String(req.uid), actor: { id: String(req.uid), ip: requestAddress(req) } };
};

const sourceOf = (req) => P.bySource((req.params || {}).source);

/* The browser-safe Google Picker config — not OAuth, so it rides the company app's `extra` map or the instance
 * defaults in `.env`. The project number (app id) is what lets a drive.file grant reach a picked file at all. */
const googlePickerConfig = (app) => {
    const extra = (app && app.extra) || {};
    return {
        api_key: String(extra.pickerApiKey || process.env.CONNECTOR_GOOGLE_PICKER_API_KEY || '').trim(),
        app_id: String(extra.appId || process.env.CONNECTOR_GOOGLE_APP_ID || '').trim(),
    };
};

const ownConnection = (who, provider) => connections.resolveConnection({ companyId: who.companyId, userId: who.userId, provider });

/* GET /api/v2/connectors/picker/:source/token
 * Drive: the owner's own short-lived access token (the single FR-15 exception) plus the browser-safe Picker
 * config. Dropbox: no token — the Chooser signs the person in with the app key (the OAuth client id). */
exports.token = async (req, res) => {
    try {
        const who = await personOrRefuse(req, res);
        if (!who) return undefined;
        const meta = sourceOf(req);
        if (!meta) return refuse(res, 404, 'Unknown picker provider.');

        let app;
        try {
            app = await apps.resolveApp({ companyId: who.companyId, provider: meta.provider });
        } catch (e) {
            return refuse(res, 404, `${meta.provider} is not set up for this workspace yet.`, { code: 'provider_off' });
        }

        if (!meta.needsToken) {
            return res.send({ status: true, statusText: 'Picker ready.', data: { token: '', config: { app_key: app.clientId } } });
        }

        let connection;
        try {
            connection = await ownConnection(who, meta.provider);
        } catch (e) {
            return refuse(res, 409, 'Connect Google on Connectors and tick Drive first.', { code: (e && e.code) || 'not_connected' });
        }
        if (!(connection.scopes || []).includes(meta.scope)) {
            return refuse(res, 409, 'Tick Drive on your Google connection in Connectors first.', { code: 'scope_missing' });
        }
        let token;
        try {
            token = await connection.getAccessToken();
        } catch (e) {
            return refuse(res, 409, 'Reconnect Google on Connectors.', { code: (e && e.code) || 'reauth_required' });
        }
        return res.send({ status: true, statusText: 'Picker ready.', data: { token, config: googlePickerConfig(app) } });
    } catch (e) {
        logger.error(`${LOG} token: ${(e && e.name) || 'Error'}`);
        return refuse(res, 500, 'Something went wrong.');
    }
};

/* GET /api/v2/connectors/picker/:source/thumbnail?fileId=...
 * A preview for one linked file. Always 200 with { url } — a missing preview is cosmetic, so the tile falls back
 * to its placeholder rather than erroring. */
exports.thumbnail = async (req, res) => {
    const meta = sourceOf(req);
    try {
        const who = await personOrRefuse(req, res);
        if (!who) return undefined;
        if (!meta) return refuse(res, 404, 'Unknown picker provider.');
        const fileId = P.clip((req.query || {}).fileId, 512);
        if (!fileId) return refuse(res, 400, 'fileId is required.');

        const request = P.thumbnailRequestFor(meta.source, fileId);
        if (!request) return res.send({ status: true, data: { url: '' } });

        let token;
        try {
            token = await (await ownConnection(who, meta.provider)).getAccessToken();
        } catch (e) {
            return res.send({ status: true, data: { url: '' } });
        }
        const response = await axios.get(request.url, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
        const url = request.pick(response.data) || '';
        return res.send({ status: true, data: { url: P.isHttpsUrl(url) ? url : '' } });
    } catch (e) {
        logger.error(`${LOG} thumbnail (${(meta && meta.source) || ''}): ${(e && e.name) || 'Error'}`);
        return res.send({ status: true, data: { url: '' } });
    }
};

/* Put an imported file where a normal upload would, honouring STORAGE_TYPE, by calling the same storage
 * primitives the upload routes use rather than reimplementing either backend. */
const storeImportedFile = async ({ companyId, storagePath, tmpPath, filename, size }) => {
    await require('../Entitlements/uploads').assertUploadAllowed(companyId, size);
    const storageType = String(process.env.STORAGE_TYPE || 'wasabi');
    if (storageType === 'server') {
        const dest = path.join(__dirname, '../../storage', String(companyId), storagePath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(tmpPath, dest);
        return storagePath;
    }
    const { uploadFileWasabiPromise } = require('../storage/wasabi/controller');
    const stored = await uploadFileWasabiPromise(String(companyId), storagePath, tmpPath, false, { path: tmpPath, originalname: filename, size }, '');
    return Array.isArray(stored) ? stored[0] : stored;
};

/* POST /api/v2/connectors/picker/:source/import  { fileId, filename, path, downloadUrl? }
 * "Import a copy": pull the bytes with the owner's own token (or the Dropbox direct link) and hand them to the
 * ordinary upload storage layer. The result carries no `source`, so from here it is an ordinary attachment. */
exports.importFile = async (req, res) => {
    let tmpPath = '';
    const meta = sourceOf(req);
    try {
        const who = await personOrRefuse(req, res);
        if (!who) return undefined;
        if (!meta) return refuse(res, 404, 'Unknown picker provider.');
        const body = req.body || {};
        const fileId = P.clip(body.fileId, 512);
        const storagePath = P.clip(body.path, 1024);
        if (!fileId) return refuse(res, 400, 'fileId is required.');
        if (!storagePath) return refuse(res, 400, 'path is required.');
        // The path becomes a filesystem/bucket key — refuse traversal outright.
        if (storagePath.includes('..') || storagePath.startsWith('/') || storagePath.includes('\\')) return refuse(res, 400, 'path is not valid.');
        if (!(await changeVerdict({ companyId: who.companyId, uid: who.userId, key: storagePath, action: UPLOAD })).allowed) {
            return refuse(res, 403, 'You cannot add a file there.');
        }

        // The Dropbox Chooser's `direct` link comes from the browser, so it is host-checked before the server fetches it.
        const suppliedUrl = P.clip(body.downloadUrl, 2048);
        const useSuppliedUrl = meta.source === 'dropbox' && !!suppliedUrl;
        if (useSuppliedUrl && !P.isDropboxContentUrl(suppliedUrl)) {
            logger.error(`${LOG} import rejected a non-Dropbox download URL from user ${who.userId}`);
            return refuse(res, 400, 'That download link is not a Dropbox URL.');
        }

        let request;
        let authHeader = {};
        if (useSuppliedUrl) {
            request = { url: suppliedUrl, method: 'get', headers: {} };
        } else {
            request = P.downloadRequestFor(meta.source, fileId);
            if (!request) return refuse(res, 400, 'This provider cannot be imported from.');
            let token;
            try {
                token = await (await ownConnection(who, meta.provider)).getAccessToken();
            } catch (e) {
                const statusText = meta.source === 'dropbox'
                    ? 'Connect Dropbox on Connectors, or re-pick the file with "Import a copy".'
                    : 'Connect Google on Connectors and tick Drive first.';
                return refuse(res, 409, statusText, { code: (e && e.code) || 'not_connected' });
            }
            authHeader = { Authorization: `Bearer ${token}` };
        }

        const download = await axios({
            method: request.method || 'get',
            url: request.url,
            headers: { ...(request.headers || {}), ...authHeader },
            responseType: 'arraybuffer',
            timeout: 120000,
            maxContentLength: MAX_IMPORT_BYTES,
            maxBodyLength: MAX_IMPORT_BYTES,
            maxRedirects: 5,
            // A Dropbox direct link redirects to a per-user content host; never let a redirect walk off the allow-list.
            beforeRedirect: useSuppliedUrl
                ? (options) => {
                    const next = `${options.protocol}//${options.hostname}${options.path || ''}`;
                    if (!P.isDropboxContentUrl(next)) throw new Error('Refused a redirect away from Dropbox.');
                }
                : undefined,
        });

        const buffer = Buffer.from(download.data);
        if (buffer.length > MAX_IMPORT_BYTES) {
            return refuse(res, 413, `That file is larger than the ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB import limit.`);
        }

        const filename = P.clip(body.filename || path.basename(storagePath), 255);
        tmpPath = path.join(os.tmpdir(), `alianhub-connector-${Date.now()}-${Math.abs(buffer.length)}-${path.basename(storagePath)}`);
        fs.writeFileSync(tmpPath, buffer);
        const storedPath = await storeImportedFile({ companyId: who.companyId, storagePath, tmpPath, filename, size: buffer.length });

        logger.info(`${LOG} imported ${filename} (${buffer.length} bytes) from ${meta.source} for user ${who.userId}`);
        return res.send({ status: true, statusText: 'Imported.', data: { url: storedPath, size: buffer.length, filename } });
    } catch (e) {
        const entitlements = require('../Entitlements/answers');
        if (entitlements.isRefusalError(e)) return res.status(e.statusCode).send(entitlements.refusalBody(e.refusal));
        // arraybuffer means an error body arrives as bytes, not JSON — decode it or the reason is lost.
        let payload = e.response && e.response.data;
        if (payload && (Buffer.isBuffer(payload) || payload instanceof ArrayBuffer)) {
            try { payload = JSON.parse(Buffer.from(payload).toString('utf8')); } catch (_e) { payload = null; }
        }
        let detail = (payload && (payload.error_description || payload.error_summary || (payload.error && (payload.error.message || payload.error)))) || e.message;
        const status = (e.response && e.response.status) || '';
        if (String(status) === '404' && meta && meta.source === 'google_drive') {
            detail = `${detail} — Drive returned 404 for a picked file. The Google app id (project number) is probably not set on the connectors Google app; without it drive.file never grants this app the picked file.`;
        }
        logger.error(`${LOG} importFile (${status}): ${typeof detail === 'string' ? detail : 'import failed'}`);
        return refuse(res, 502, typeof detail === 'string' ? detail.slice(0, 300) : 'Import failed.');
    } finally {
        if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_e) { /* already gone */ } }
    }
};

exports.__test__ = { googlePickerConfig, storeImportedFile, MAX_IMPORT_BYTES };
