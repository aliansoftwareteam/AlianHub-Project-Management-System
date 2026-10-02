const { signSession, startApp } = require('./sessionApp');
const { setMiddlewareV2, setMiddlewareWithCV2 } = require('../../Config/setMiddleware');

const WORKSPACE = '6f0000000000000000000c01';
const OTHER_WORKSPACE = '6f0000000000000000000c02';
const OWNER = '6f00000000000000000000a1';
const ADMIN = '6f00000000000000000000a2';
const MEMBER = '6f00000000000000000000a3';

const ROLE_BY_USER = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3 };

const serveModule = (init) => startApp((server) => {
    setMiddlewareWithCV2(server);
    setMiddlewareV2(server);
    init(server);
});

const seedSeats = (mockDb, dbCollections, companyId = WORKSPACE) => Object.entries(ROLE_BY_USER).forEach(([userId, roleType]) => {
    mockDb.seed(dbCollections.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false, companyId });
});

const tokenFor = (uid, companyIds = [WORKSPACE]) => signSession(uid, companyIds);

const sameId = (a, b) => String(a && a.toHexString ? a.toHexString() : a) === String(b && b.toHexString ? b.toHexString() : b);

/* A call names the workspace when it is the database it opens, or when the company row it reads or writes in the global database is that workspace's own. */
const namesWorkspace = (call, companyId = WORKSPACE) => {
    if (sameId(call.companyId, companyId)) return true;
    if (call.companyId !== 'global') return false;
    const filter = Array.isArray(call.data) ? call.data[0] : call.data;
    return Boolean(filter) && sameId(filter._id, companyId);
};

const unnamed = (calls, companyId = WORKSPACE) => calls.filter((call) => !namesWorkspace(call, companyId));

module.exports = { WORKSPACE, OTHER_WORKSPACE, OWNER, ADMIN, MEMBER, serveModule, seedSeats, tokenFor, namesWorkspace, unnamed };
