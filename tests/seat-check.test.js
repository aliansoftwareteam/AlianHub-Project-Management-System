const { collectSeatless } = require('../scripts/seat-check');

const A = '6f0000000000000000000c01';
const B = '6f0000000000000000000c02';
const ALICE = '6f0000000000000000000001';
const BOB = '6f0000000000000000000002';
const CAROL = '6f0000000000000000000003';

const USERS = [
    { _id: ALICE, Employee_Email: 'alice@a.test', AssignCompany: [A, B] },
    { _id: BOB, Employee_Email: 'bob@a.test', AssignCompany: [A] },
    { _id: CAROL, Employee_Email: 'carol@a.test', AssignCompany: [] },
];

const ROWS = {
    [A]: [
        { userId: ALICE, status: 2, isDelete: false },
        { userId: BOB, status: 2, isDelete: true },
    ],
    [B]: [{ userId: ALICE, status: 1, isDelete: false }],
};

const readers = (rows = ROWS) => ({
    findUsers: jest.fn(async () => USERS),
    findSeats: jest.fn(async (companyId, userIds) => (rows[companyId] || []).filter((row) => userIds.includes(row.userId))),
});

describe('seat-check', () => {
    it('lists every listed company where the account holds no active seat, with the row it does hold', async () => {
        const report = await collectSeatless(readers());

        expect(report.checked).toBe(3);
        expect(report.seatless).toEqual([
            { companyId: A, userId: BOB, email: 'bob@a.test', seat: 'removed' },
            { companyId: B, userId: ALICE, email: 'alice@a.test', seat: 'invited' },
        ]);
    });

    it('reports a company with no row at all for the account', async () => {
        const report = await collectSeatless(readers({ [A]: [{ userId: ALICE, status: 2 }] }));

        expect(report.seatless).toEqual(expect.arrayContaining([
            { companyId: A, userId: BOB, email: 'bob@a.test', seat: 'none' },
            { companyId: B, userId: ALICE, email: 'alice@a.test', seat: 'none' },
        ]));
    });

    it('reads each company once and writes nothing', async () => {
        const r = readers();
        await collectSeatless(r);

        expect(r.findSeats.mock.calls.map(([companyId]) => companyId).sort()).toEqual([A, B]);
        expect(Object.keys(r)).toEqual(['findUsers', 'findSeats']);
    });
});
