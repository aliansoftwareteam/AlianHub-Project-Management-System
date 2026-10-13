// company_users.status, the one definition every guard shares: an invitation is PENDING until it
// is accepted, ACTIVE once the seat is live, CANCELLED when it is withdrawn, and a removed member
// keeps the row with isDelete: true. Kept free of requires so pure helpers can share it.
const SEAT_PENDING = 1;
const SEAT_ACTIVE = 2;
const SEAT_CANCELLED = 3;

// A live seat. Anything else — pending, cancelled, deactivated, soft-deleted — is not a member.
const ACTIVE_SEAT = { status: SEAT_ACTIVE, isDelete: { $ne: true } };

// A seat the invitation flow may still act on before it is accepted.
const INVITED_SEAT = { status: { $in: [SEAT_PENDING, SEAT_ACTIVE] }, isDelete: { $ne: true } };

module.exports = { SEAT_PENDING, SEAT_ACTIVE, SEAT_CANCELLED, ACTIVE_SEAT, INVITED_SEAT };
