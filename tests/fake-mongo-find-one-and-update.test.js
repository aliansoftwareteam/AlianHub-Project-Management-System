const { create } = require('./fixtures/fakeMongo');

/* The driver answers findOneAndUpdate with the document as it was before the update unless told otherwise, and with
 * null when an upsert inserted; a fake that always answers with the updated document hides a missing `new: true`. */
describe('fakeMongo findOneAndUpdate', () => {
    const crud = (db, data) => db.crud('c1', { type: 'things', data }, 'findOneAndUpdate');

    it('answers an upsert that inserts with null by default, and with the document when asked for the new one', async () => {
        const db = create();
        expect(await crud(db, [{ _id: 'a' }, { $set: { n: 1 } }, { upsert: true }])).toBeNull();
        expect(db.store.things).toEqual([{ _id: 'a', n: 1 }]);
        expect(await crud(db, [{ _id: 'b' }, { $set: { n: 2 } }, { upsert: true, new: true }])).toEqual({ _id: 'b', n: 2 });
        expect(await crud(db, [{ _id: 'c' }, { $set: { n: 3 } }, { upsert: true, returnDocument: 'after' }])).toEqual({ _id: 'c', n: 3 });
        expect(await crud(db, [{ _id: 'd' }, { $set: { n: 4 } }, { upsert: true, returnOriginal: false }])).toEqual({ _id: 'd', n: 4 });
    });

    it('answers an update of an existing document with the document before it, unless asked for the new one', async () => {
        const db = create();
        db.seed('things', { _id: 'a', n: 1 });
        expect(await crud(db, [{ _id: 'a' }, { $inc: { n: 1 } }])).toEqual({ _id: 'a', n: 1 });
        expect(await crud(db, [{ _id: 'a' }, { $inc: { n: 1 } }, { new: true }])).toEqual({ _id: 'a', n: 3 });
        expect(await crud(db, [{ _id: 'a' }, { $inc: { n: 1 } }, { returnDocument: 'before' }])).toEqual({ _id: 'a', n: 3 });
        expect(db.store.things[0].n).toBe(4);
    });

    it('refuses an upsert that would insert a second document with an _id that exists, as the _id index does', async () => {
        const db = create();
        db.seed('things', { _id: 'a', v: 3 });
        await expect(crud(db, [{ _id: 'a', v: 0 }, { $set: { n: 1 } }, { upsert: true, new: true }])).rejects.toMatchObject({ code: 11000 });
        await expect(db.crud('c1', { type: 'things', data: [{ _id: 'a', v: 0 }, { $set: { n: 1 } }, { upsert: true }] }, 'updateOne')).rejects.toMatchObject({ code: 11000 });
        expect(db.store.things).toEqual([{ _id: 'a', v: 3 }]);
    });
});
