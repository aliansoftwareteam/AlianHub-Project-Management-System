const { hashFeedToken } = require('../Modules/Calendar/helpers/icalRules');

/* Calendar feed tokens were stored in clear, so a read of the collection handed out every
 * subscription URL. Each stored token is replaced by its SHA-256 hash. The .ics route hashes the
 * token it receives, so a URL someone already subscribed to keeps working. There is no down():
 * a hash cannot be turned back into the token. */
module.exports = {
    id: '012-hash-calendar-feed-tokens',
    scope: 'global',
    async up(ctx) {
        const type = ctx.SCHEMA_TYPE.CALENDAR_FEEDS;
        const feeds = await ctx.global({ type, data: [{ token: { $type: 'string' } }, { token: 1 }] }, 'find') || [];
        let hashed = 0;
        for (const feed of feeds) {
            const result = await ctx.global({
                type,
                data: [{ _id: feed._id, token: feed.token }, { $set: { tokenHash: hashFeedToken(feed.token) }, $unset: { token: '' } }],
            }, 'updateOne');
            hashed += result && result.modifiedCount ? 1 : 0;
        }
        ctx.logger.info(`[migrations] 012-hash-calendar-feed-tokens hashed ${hashed} of ${feeds.length} feed token(s)`);
        return { hashed };
    },
};
