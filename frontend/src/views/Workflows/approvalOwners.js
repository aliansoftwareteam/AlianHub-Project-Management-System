import { ROLE_GUEST } from '@/utils/roles';

/* An approval is owned by a member of the workspace, so a picker for one never offers a guest. `seats` are the company's seats, each naming a person and a role. */
export const membersOnly = (users = [], seats = []) => {
    const guests = new Set((seats || []).filter((seat) => Number(seat?.roleType) === ROLE_GUEST).map((seat) => String(seat.userId)));
    return (users || []).filter((user) => !guests.has(String(user?._id)));
};
