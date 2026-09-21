const clients = require('./clients');
const approvals = require('./approvals');
const store = require('./store');
const workspaces = require('./workspaces');
const { managerOrRefuse, actorOf } = require('./admin');
const logger = require('../../Config/loggerConfig');

const refuse = (res, code, statusText) => res.status(code).send({ status: false, statusText });

const failed = (res, error, what) => {
    if (error instanceof approvals.ApprovalError) return refuse(res, error.statusCode, error.message);
    if (error instanceof clients.ClientError) return refuse(res, 400, error.message);
    logger.error(`ERROR in ${what}: ${error.message}`);
    return refuse(res, 500, 'Something went wrong.');
};

const clientIdOf = (req) => {
    const value = req.body && req.body.clientId;
    return typeof value === 'string' && value.length <= 2000 ? value : '';
};

const view = async (rows) => {
    const names = await workspaces.peopleNamesOf(rows.flatMap((row) => [row.requestedBy, row.decidedBy]));
    return rows.map((row) => approvals.publicView(row, names));
};

exports.list = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        return res.send({ status: true, statusText: 'Agent client approvals fetched.', data: await view(await store.approvals.listFor(companyId)) });
    } catch (error) {
        return failed(res, error, 'list oauth client approvals');
    }
};

/* The client is resolved as /oauth/authorize would resolve it, a metadata document fetched included, so an
 * admin can approve a client before anyone has asked for it. */
exports.approve = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const clientId = clientIdOf(req);
        if (!clientId) return refuse(res, 400, 'clientId is required.');
        const client = await clients.resolve(clientId);
        const approval = await approvals.approve({
            companyId, client, scopes: req.body.scopes, privateSprints: req.body.privateSprints, actor: actorOf(req),
        });
        return res.send({ status: true, statusText: 'Agent client approved.', data: (await view([approval]))[0] });
    } catch (error) {
        return failed(res, error, 'approve oauth client');
    }
};

exports.deny = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const clientId = clientIdOf(req);
        if (!clientId) return refuse(res, 400, 'clientId is required.');
        const approval = await approvals.deny({ companyId, clientId, actor: actorOf(req) });
        return res.send({ status: true, statusText: 'Agent client denied.', data: (await view([approval]))[0] });
    } catch (error) {
        return failed(res, error, 'deny oauth client');
    }
};

exports.revoke = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const clientId = clientIdOf(req);
        if (!clientId) return refuse(res, 400, 'clientId is required.');
        const approval = await approvals.revoke({ companyId, clientId, actor: actorOf(req) });
        return res.send({ status: true, statusText: 'Agent client approval revoked.', data: (await view([approval]))[0] });
    } catch (error) {
        return failed(res, error, 'revoke oauth client approval');
    }
};
