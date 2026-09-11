// Mirrors Config/roleTypes.js, the role keys seeded for every company.
export const ROLE_GUEST = 0;
export const ROLE_OWNER = 1;
export const ROLE_ADMIN = 2;
export const ROLE_MEMBER = 3;

export const isOwnerOrAdmin = (roleType) => roleType === ROLE_OWNER || roleType === ROLE_ADMIN;
