const { pageVisibleTo } = require('./pageRules');
const { projectAccess, isCompanyMember } = require('../../../Config/contentAccess');

/* A doc is readable when the private-doc rule allows it and its project is visible;
 * changing it also needs edit rights on that project. A doc with no project is the
 * company's. */
const canUsePage = async (companyId, page, uid, { edit = false } = {}) => {
    if (!page || !pageVisibleTo(page, uid)) return false;
    if (!page.ProjectID) return isCompanyMember(companyId, uid);
    const access = await projectAccess(companyId, uid, page.ProjectID);
    return edit ? access.canEdit : access.visible;
};

module.exports = { canUsePage };
