// The role keys utils/data.js importCompanyRoles seeds for every company. Kept free of
// requires so pure helpers can share them without pulling in the database layer.
const ROLE_GUEST = 0;
const ROLE_OWNER = 1;
const ROLE_ADMIN = 2;
const ROLE_MEMBER = 3;

const isPrivileged = (roleType) => roleType === ROLE_OWNER || roleType === ROLE_ADMIN;

module.exports = {
    ROLE_GUEST,
    ROLE_OWNER,
    ROLE_ADMIN,
    ROLE_MEMBER,
    isPrivileged,
};
