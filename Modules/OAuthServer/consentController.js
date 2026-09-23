const fs = require('fs');
const config = require('./config');
const clients = require('./clients');
const grants = require('./grants');
const approvals = require('./approvals');
const consentRequest = require('./consentRequest');
const consentPolicy = require('./consentPolicy');
const workspaces = require('./workspaces');
const store = require('./store');
const { matchesRegistered, isAllowedRedirectUri } = require('./redirectUri');
const logger = require('../../Config/loggerConfig');
const { requestAddress } = require('../../utils/requestAddress');

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const noStore = (res) => res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });

const refuse = (res, status, error, description) => noStore(res).status(status).json({ status: false, error, error_description: description, statusText: description });

const failed = (res, error, what) => {
    logger.error(`oauth consent ${what}: ${error.message}`);
    if (res.headersSent) return undefined;
    return refuse(res, 500, 'server_error', 'The consent could not be completed.');
};

const single = (value) => (typeof value === 'string' ? value : '');

const actorOf = (req) => ({ id: String(req.uid || ''), ip: requestAddress(req) });

const redirectWith = (res, redirectUri, params) => {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
    return noStore(res).redirect(303, url.toString());
};

/* A row client (pre-registered or dynamically registered) is read again, so one revoked since the request was
 * made cannot be consented to. A metadata document client is not fetched again: the signed request already
 * carries what was validated from its document. */
const clientOf = async (opened) => {
    const client = await clients.resolve(opened.clientId, { fetchDocument: false });
    if (client.kind === 'metadata_document') return { ...client, name: opened.clientName };
    if (!matchesRegistered(client, opened.redirectUri)) throw new clients.ClientError('invalid_request', 'redirect_uri is no longer registered for this client');
    return client;
};

const clientView = (opened, client) => {
    const redirect = new URL(opened.redirectUri);
    return {
        clientId: client.clientId,
        name: client.name || opened.clientName,
        kind: client.kind,
        clientHost: client.kind === 'metadata_document' ? approvals.hostOf(client.clientId) : '',
        redirectUri: opened.redirectUri,
        redirectHost: redirect.hostname,
        loopback: LOOPBACK_HOSTS.includes(redirect.hostname),
    };
};

/* Whether this workspace can be chosen: the client belongs to it (when it was pre-registered somewhere), an owner
 * or admin approved it there, and that approval covers every scope asked for. */
const standingIn = (companyId, client, approval, scopes) => {
    if (client.companyId && String(client.companyId) !== String(companyId)) return { approval: 'none', eligible: false, reason: 'other_workspace' };
    if (!approval) return { approval: 'none', eligible: false, reason: 'not_approved' };
    if (approval.status !== approvals.STATUS.APPROVED) return { approval: approval.status, eligible: false, reason: 'not_approved' };
    if (!approvals.covers(approval, scopes)) return { approval: approval.status, eligible: false, reason: 'scope_ceiling' };
    return { approval: approval.status, eligible: true, reason: '' };
};

// The person, from their session, never an API token: a token is not someone consenting.
const personOrRefuse = (req, res) => {
    if (req.apiToken || !req.uid) {
        refuse(res, 403, 'access_denied', 'Only a signed-in person can answer a consent request.');
        return false;
    }
    return true;
};

exports.page = (indexFile) => (req, res) => {
    const opened = consentRequest.open(single(req.query && req.query.request));
    noStore(res).set({ 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    if (!opened || !isAllowedRedirectUri(opened.redirectUri)) {
        res.set('Content-Security-Policy', consentPolicy.REFUSAL_POLICY);
        return res.status(400).type('text/plain').send('This sign-in request has expired or is not valid. Start again from the app that sent you here.');
    }
    res.set('Content-Security-Policy', consentPolicy.pagePolicy(opened.redirectUri, process.env, { reportingApi: Boolean(req.secure) }));
    if (!fs.existsSync(indexFile)) return res.status(503).type('text/plain').send('The web app is not built on this server.');
    return res.sendFile(indexFile);
};

exports.details = async (req, res) => {
    try {
        if (!personOrRefuse(req, res)) return undefined;
        const opened = consentRequest.open(single(req.query && req.query.request));
        if (!opened) return refuse(res, 400, 'invalid_request', 'This sign-in request has expired or is not valid.');
        const csrf = consentRequest.cookieToken(req, opened);
        if (!csrf) return refuse(res, 403, 'access_denied', 'This sign-in request was started in another browser.');
        const client = await clientOf(opened);
        const [mine, person] = await Promise.all([workspaces.workspacesOf(req.uid), workspaces.personOf(req.uid)]);
        const standing = await Promise.all(mine.map(async (w) => ({ ...w, ...standingIn(w.id, client, await store.approvals.find(w.id, client.clientId), opened.scopes) })));
        return noStore(res).send({ status: true, data: { client: clientView(opened, client), person, scopes: opened.scopes, csrf, workspaces: standing } });
    } catch (error) {
        if (error instanceof clients.ClientError) return refuse(res, 400, error.error, error.message);
        return failed(res, error, 'details');
    }
};

/* The consent form's answer. Every refusal before the CSRF check and the client check stays here, because until
 * then nothing says this browser, this request or this redirect URI can be trusted with a redirect. */
exports.answer = async (req, res) => {
    try {
        if (!personOrRefuse(req, res)) return undefined;
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const opened = consentRequest.open(single(body.request));
        if (!opened) return refuse(res, 400, 'invalid_request', 'This sign-in request has expired or is not valid.');
        if (!consentRequest.csrfMatches(req, opened, single(body.csrf))) return refuse(res, 403, 'access_denied', 'This answer did not come from the consent page.');
        const client = await clientOf(opened);
        const back = (params) => {
            consentRequest.clearCookie(res, opened);
            return redirectWith(res, opened.redirectUri, { ...params, state: opened.state, iss: config.issuer() });
        };
        const spend = async (companyId) => {
            try {
                await store.consents.spend({
                    nonce: opened.nonce, clientId: client.clientId, companyId, userId: req.uid, scopes: opened.scopes, resource: config.resource(),
                    now: new Date(), expiresAt: new Date(opened.expiresAt),
                });
                return true;
            } catch (error) {
                if (error && (error.code === 11000 || /E11000/.test(String(error.message)))) return false;
                throw error;
            }
        };
        const alreadyAnswered = () => refuse(res, 400, 'invalid_request', 'This sign-in request has already been answered.');

        const decision = single(body.decision);
        if (decision === 'deny') return (await spend('')) ? back({ error: 'access_denied', error_description: 'the user declined' }) : alreadyAnswered();
        if (decision !== 'approve') return refuse(res, 400, 'invalid_request', 'decision must be approve or deny');

        const companyId = single(body.workspace);
        if (!(await workspaces.isMember(req.uid, companyId))) return refuse(res, 403, 'access_denied', 'You are not a member of that workspace.');
        const approval = await store.approvals.find(companyId, client.clientId);
        const standing = standingIn(companyId, client, approval, opened.scopes);
        if (!standing.eligible) {
            if (!approval && standing.reason === 'not_approved') {
                await approvals.request({ companyId, client, userId: req.uid, scopes: opened.scopes, actor: actorOf(req) });
            }
            return refuse(res, 403, 'access_denied', standing.reason === 'scope_ceiling'
                ? 'This workspace has not approved the client for every scope it asks for.'
                : 'An owner or admin of this workspace has to approve this client first.');
        }

        if (!(await spend(companyId))) return alreadyAnswered();
        const { code } = await grants.issueCode({
            client, companyId, userId: req.uid, scopes: opened.scopes, redirectUri: opened.redirectUri, codeChallenge: opened.codeChallenge,
        });
        return back({ code });
    } catch (error) {
        if (error instanceof clients.ClientError) return refuse(res, 400, error.error, error.message);
        return failed(res, error, 'answer');
    }
};

exports.requestApproval = async (req, res) => {
    try {
        if (!personOrRefuse(req, res)) return undefined;
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const opened = consentRequest.open(single(body.request));
        if (!opened) return refuse(res, 400, 'invalid_request', 'This sign-in request has expired or is not valid.');
        if (!consentRequest.csrfMatches(req, opened, single(body.csrf))) return refuse(res, 403, 'access_denied', 'This request did not come from the consent page.');
        const client = await clientOf(opened);
        const companyId = single(body.workspace);
        if (!(await workspaces.isMember(req.uid, companyId))) return refuse(res, 403, 'access_denied', 'You are not a member of that workspace.');
        if (client.companyId && String(client.companyId) !== companyId) return refuse(res, 403, 'access_denied', 'This client is registered to another workspace.');
        const { approval, limited } = await approvals.request({ companyId, client, userId: req.uid, scopes: opened.scopes, actor: actorOf(req) });
        if (limited) {
            return refuse(res, 429, 'temporarily_unavailable', limited === 'cooldown'
                ? 'An admin turned this client down recently; it can be asked for again a day after that.'
                : 'You have asked for approval of many clients today; try again tomorrow.');
        }
        return noStore(res).send({ status: true, statusText: 'Approval requested.', data: { approval: approval ? approval.status : approvals.STATUS.PENDING } });
    } catch (error) {
        if (error instanceof clients.ClientError) return refuse(res, 400, error.error, error.message);
        return failed(res, error, 'approval request');
    }
};
