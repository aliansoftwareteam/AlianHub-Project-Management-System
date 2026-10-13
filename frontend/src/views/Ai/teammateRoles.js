import { ROLE_ADMIN, ROLE_GUEST, ROLE_MEMBER, ROLE_OWNER } from "@/utils/roles";

const ROWS = {
    [ROLE_OWNER]: { role: "Parity.role_owner", access: "Parity.everything" },
    [ROLE_ADMIN]: { role: "Parity.role_admin", access: "Parity.everything" },
    [ROLE_MEMBER]: { role: "Parity.role_member", access: "Parity.access_member" },
    [ROLE_GUEST]: { role: "Parity.role_guest", access: "Parity.access_guest" },
};

// An unrecognised role reads as the narrowest one rather than claiming full access.
export const teammateRoleKeys = (roleType) => ROWS[Number(roleType)] || ROWS[ROLE_GUEST];
