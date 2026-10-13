const { readFirstSeen, keepEarliestFirstSeen } = require('../Modules/Instance/backups');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 17, 9, 0, 0);

/* The native global database, holding only the instance settings document. */
const globalDb = (doc) => {
    const state = { doc: doc ? { ...doc } : null, writes: [] };
    const settings = {
        findOne: async (filter) => (state.doc && state.doc._id === filter._id ? { ...state.doc } : null),
        updateOne: async (filter, update, options) => {
            state.writes.push({ filter, update, options });
            state.doc = { _id: filter._id, ...(state.doc || {}), ...update.$set };
        },
    };
    return { state, collection: (name) => (name === 'instance_settings' ? settings : null) };
};

describe('a restore keeps the earliest recorded grace start', () => {
    it('puts back the start the instance had when the backup was taken before strict mode was on', async () => {
        const started = new Date(NOW - 12 * DAY);
        const live = globalDb({ _id: 'instance', values: {}, apiTokenStrictSince: started });
        const before = await readFirstSeen(live);

        live.state.doc = { _id: 'instance', values: { APP_NAME: 'Restored' } };
        await keepEarliestFirstSeen(live, before);
        expect(live.state.doc.apiTokenStrictSince.getTime()).toBe(started.getTime());
        expect(live.state.doc.values).toEqual({ APP_NAME: 'Restored' });
    });

    it('recreates the document when the backup had no instance settings at all', async () => {
        const started = new Date(NOW - 12 * DAY);
        const live = globalDb({ _id: 'instance', apiTokenStrictSince: started });
        const before = await readFirstSeen(live);

        live.state.doc = null;
        await keepEarliestFirstSeen(live, before);
        expect(live.state.doc).toEqual({ _id: 'instance', apiTokenStrictSince: started });
        expect(live.state.writes[0].options).toMatchObject({ upsert: true });
    });

    it('keeps a restored start that is earlier than the live one', async () => {
        const live = globalDb({ _id: 'instance', apiTokenStrictSince: new Date(NOW - 2 * DAY) });
        const before = await readFirstSeen(live);

        const earlier = new Date(NOW - 40 * DAY);
        live.state.doc = { _id: 'instance', apiTokenStrictSince: earlier };
        await keepEarliestFirstSeen(live, before);
        expect(live.state.doc.apiTokenStrictSince.getTime()).toBe(earlier.getTime());
        expect(live.state.writes).toHaveLength(0);
    });

    it('writes nothing when strict mode had never been on', async () => {
        const live = globalDb({ _id: 'instance', values: {} });
        const before = await readFirstSeen(live);
        live.state.doc = { _id: 'instance', values: {} };
        await keepEarliestFirstSeen(live, before);
        expect(live.state.writes).toHaveLength(0);
        expect(live.state.doc.apiTokenStrictSince).toBeUndefined();
    });
});
