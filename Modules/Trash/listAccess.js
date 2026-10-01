const { canReadProject } = require('../../Config/projectAccess');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { projectAccess } = require('../../Config/contentAccess');
const { canSeeSprint, hiddenSprintIds, sprintIdentities } = require('../Sprints/helpers/sprintVisibility');
const { pageVisibleTo } = require('../Pages/helpers/pageRules');
const { readsCompanyWide } = require('../Tasks/helpers/taskQueryGuard');

const memoised = (read) => {
    const seen = new Map();
    return (id) => {
        const key = String(id || '');
        if (!seen.has(key)) seen.set(key, read(key));
        return seen.get(key);
    };
};

const keepWhere = async (docs, test) => {
    const verdicts = await Promise.all(docs.map(test));
    return docs.filter((doc, index) => verdicts[index]);
};

/* Owners and admins also see lists and tasks outside any project, such as chat channels; a chat
 * itself stays with the people in it. */
const inReadableProject = (caller, projectId) => caller.readProject(projectId)
    .then((decision) => decision.allowed || (caller.privileged && (!projectId || Boolean(decision.missing))));

const KEEP = {
    projects: (caller, docs) => keepWhere(docs, (doc) => caller.readProject(doc._id).then((decision) => decision.allowed)),
    /* Chat categories share the folders collection; the trash restores project folders only. */
    folders: (caller, docs) => keepWhere(docs, (doc) => caller.readProject(doc.projectId).then((decision) => Boolean(decision.allowed))),
    lists: async (caller, docs) => {
        const identities = caller.privileged ? null : await sprintIdentities(caller.companyId, caller.uid);
        return keepWhere(docs, async (doc) => (await inReadableProject(caller, doc.projectId)) && (caller.privileged || canSeeSprint(doc, identities)));
    },
    tasks: async (caller, docs) => {
        const hidden = caller.privileged
            ? new Set()
            : new Set((await hiddenSprintIds(caller.companyId, caller.uid, docs.map((doc) => doc.ProjectID))).map(String));
        return keepWhere(docs, async (doc) => readsCompanyWide(doc, caller.uid, [])
            && (await inReadableProject(caller, doc.ProjectID)) && !hidden.has(String(doc.sprintId || '')));
    },
    docs: (caller, docs) => {
        const docProject = memoised((projectId) => projectAccess(caller.companyId, caller.uid, projectId));
        return keepWhere(docs, async (doc) => pageVisibleTo(doc, caller.uid) && (!doc.ProjectID || (await docProject(doc.ProjectID)).visible));
    },
};

const visibleTrash = async (companyId, uid, kind, docs) => {
    if (!docs.length) return docs;
    const roleType = await getRoleType(companyId, String(uid || ''));
    if (roleType === null) return [];
    const caller = {
        companyId,
        uid: String(uid),
        privileged: isPrivileged(roleType),
        readProject: memoised((projectId) => canReadProject(companyId, uid, projectId)),
    };
    return KEEP[kind](caller, docs);
};

module.exports = { visibleTrash };
