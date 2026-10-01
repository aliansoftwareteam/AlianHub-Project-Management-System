const { pageVisibleTo, shareFor } = require('./pageRules');
const { projectAccess, isCompanyMember, isCompanyAdmin } = require('../../../Config/contentAccess');

const throughProject = async (companyId, page, uid, edit) => {
    if (!pageVisibleTo(page, uid)) return false;
    if (!page.ProjectID) return isCompanyMember(companyId, uid);
    const access = await projectAccess(companyId, uid, page.ProjectID);
    return edit ? access.canEdit : access.visible;
};

/* A doc is readable when the private-doc rule allows it and its project is visible; changing it also
 * needs edit rights on that project. A doc with no project is the company's. A doc shared with a person
 * by name is theirs to read, and to change as an editor, while they hold a seat: the seat is read on
 * every call, never kept with the share. `named: false` asks what the person reaches without it. */
const canUsePage = async (companyId, page, uid, { edit = false, named = true } = {}) => {
    if (!page) return false;
    if (await throughProject(companyId, page, uid, edit)) return true;
    if (!named) return false;
    const share = shareFor(page, uid);
    if (!share || (edit && share.role !== 'editor')) return false;
    return isCompanyMember(companyId, uid);
};

/* The author, an owner or an admin, and only over a doc they reach without being named on it, so a
 * private doc stays its author's to share. */
const canManageShares = async (companyId, page, uid) => {
    if (!(await canUsePage(companyId, page, uid, { named: false }))) return false;
    return String(page.createdBy || '') === String(uid || '') || isCompanyAdmin(companyId, uid);
};

module.exports = { canUsePage, canManageShares };
