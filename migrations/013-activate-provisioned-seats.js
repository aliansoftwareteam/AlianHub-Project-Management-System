const { SEAT_PENDING, SEAT_ACTIVE } = require('../Config/seatStatus');

/* SSO just-in-time provisioning and SCIM wrote a new membership with status 1, which is the value
 * the invitation flow uses for "invited, not accepted yet". Now that a role is only read from an
 * active seat, those users would hold no role at all, so each such row is moved to status 2.
 *
 * An invitation is told apart by sendInvitationTime and linkId, which Modules/Auth/controller/
 * sendInvitation always writes and provisioning never does: a genuine pending invitation keeps
 * both and is left alone. */

const ID = '013-activate-provisioned-seats';

const provisionedSeats = {
    status: SEAT_PENDING,
    isDelete: { $ne: true },
    userId: { $exists: true },
    sendInvitationTime: { $exists: false },
    linkId: { $exists: false },
};

async function activateCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.COMPANY_USERS;
    const seats = await ctx.company(companyId, { type, data: [provisionedSeats, { _id: 1 }] }, 'find') || [];
    let activated = 0;
    for (const seat of seats) {
        const result = await ctx.company(companyId, {
            type,
            data: [{ _id: seat._id, ...provisionedSeats }, { $set: { status: SEAT_ACTIVE } }],
        }, 'updateOne');
        activated += result && result.modifiedCount ? 1 : 0;
    }
    return { activated, found: seats.length };
}

module.exports = {
    id: ID,
    scope: 'company',
    activateCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const counts = await activateCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 013 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
