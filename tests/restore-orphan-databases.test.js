const { orphanDatabases } = require('../Modules/Instance/backups');

const RESTORED = '6a8ee973d625fca52e519a12';
const LATER = '6b0000000000000000000001';
const ASSIGNED_ONLY = '6b0000000000000000000002';

describe('company databases a restore leaves behind', () => {
    const live = [
        { name: 'admin', sizeOnDisk: 40960 },
        { name: 'config', sizeOnDisk: 12288 },
        { name: 'local', sizeOnDisk: 40960 },
        { name: 'global', sizeOnDisk: 819200 },
        { name: RESTORED, sizeOnDisk: 204800 },
        { name: LATER, sizeOnDisk: 102400 },
        { name: ASSIGNED_ONLY, sizeOnDisk: 8192 },
        { name: 'someone-elses-app', sizeOnDisk: 4096 },
    ];

    it('lists a company database the restored global data no longer names, with its size', () => {
        expect(orphanDatabases(live, [RESTORED, ASSIGNED_ONLY])).toEqual([{ name: LATER, sizeOnDisk: 102400 }]);
    });

    it('never lists a database the restored global data still references', () => {
        const names = orphanDatabases(live, [RESTORED, ASSIGNED_ONLY, LATER]).map((db) => db.name);
        expect(names).toEqual([]);
    });

    it('ignores system, global and non-company databases', () => {
        const names = orphanDatabases(live, []).map((db) => db.name);
        expect(names).toEqual([RESTORED, LATER, ASSIGNED_ONLY]);
    });

    it('matches references given as ObjectIds', () => {
        const asObjectId = { toString: () => RESTORED };
        expect(orphanDatabases(live, [asObjectId, ASSIGNED_ONLY, LATER])).toEqual([]);
    });
});
