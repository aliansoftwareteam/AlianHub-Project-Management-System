import { ROLE_ADMIN, ROLE_OWNER } from "@/utils/roles";

const SEAT_CANCELLED = 3;
const SHOWN = 2;

const isActive = (seat) => Boolean(seat && seat.userId) && seat.isDelete !== true && Number(seat.status) !== SEAT_CANCELLED;
const rank = (seat) => (seat.roleType === ROLE_OWNER ? 0 : 1);

/* The owner first, then admins, as the people list names them; a seat with no known name is left out. */
export function adminNames(seats, users) {
    const named = new Map((users || []).map((user) => [String(user._id), String(user.Employee_Name || "").trim()]));
    return (seats || [])
        .filter((seat) => isActive(seat) && (seat.roleType === ROLE_OWNER || seat.roleType === ROLE_ADMIN))
        .sort((a, b) => rank(a) - rank(b))
        .map((seat) => named.get(String(seat.userId)) || "")
        .filter((name, index, all) => name && all.indexOf(name) === index)
        .slice(0, SHOWN);
}
