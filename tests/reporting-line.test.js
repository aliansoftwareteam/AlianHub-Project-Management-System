const R = require('../Modules/Users/helpers/reportingLine');

const member = (userId, extra = {}) => ({
    _id: `doc_${userId}`,
    userId,
    userEmail: `${userId}@example.com`,
    Employee_Name: userId.toUpperCase(),
    status: 2,
    roleType: 3,
    isDelete: false,
    managerId: '',
    ...extra
});

// a -> b -> c, with c at the top.
const chain = () => [
    member('a', { managerId: 'b' }),
    member('b', { managerId: 'c' }),
    member('c')
];

describe('validateManagerAssignment', () => {
    test('nobody manages themselves', () => {
        const r = R.validateManagerAssignment([member('a'), member('b')], 'a', 'a');
        expect(r.ok).toBe(false);
        expect(r.reason).toBe(R.REASON.SELF);
    });

    test('clearing a manager is always allowed and normalizes to ""', () => {
        for (const empty of [null, undefined, '', '  ', 'null']) {
            const r = R.validateManagerAssignment([member('a', { managerId: 'b' }), member('b')], 'a', empty);
            expect(r).toEqual({ ok: true, managerId: '' });
        }
    });

    test('a plain assignment is accepted', () => {
        expect(R.validateManagerAssignment([member('a'), member('b')], 'a', 'b')).toEqual({ ok: true, managerId: 'b' });
    });

    test('refuses a two-node cycle', () => {
        const people = [member('a', { managerId: 'b' }), member('b')];
        const r = R.validateManagerAssignment(people, 'b', 'a');
        expect(r.ok).toBe(false);
        expect(r.reason).toBe(R.REASON.CYCLE);
    });

    test('refuses a three-node cycle a -> b -> c -> a', () => {
        const r = R.validateManagerAssignment(chain(), 'c', 'a');
        expect(r.ok).toBe(false);
        expect(r.reason).toBe(R.REASON.CYCLE);
    });

    test('accepts a valid deep chain and does not mistake depth for a cycle', () => {
        const people = chain().concat(member('d'));
        expect(R.validateManagerAssignment(people, 'd', 'a')).toEqual({ ok: true, managerId: 'a' });
        expect(R.ancestorsOf(new Map(people.map((m) => [m.userId, m])), 'a')).toEqual(['b', 'c']);
    });

    test('a sibling under the same manager is not a cycle', () => {
        const people = [member('a', { managerId: 'c' }), member('b'), member('c')];
        expect(R.validateManagerAssignment(people, 'b', 'c').ok).toBe(true);
    });

    test('refuses a guest, an invited member, a removed member and an unknown id', () => {
        const cases = [
            [member('g', { roleType: 0 }), R.REASON.GUEST],
            [member('p', { status: 1 }), R.REASON.NOT_ACTIVE],
            [member('r', { status: 3, isDelete: true }), R.REASON.NOT_ACTIVE],
            [member('x', { isDelete: true }), R.REASON.NOT_ACTIVE]
        ];
        cases.forEach(([candidate, reason]) => {
            const r = R.validateManagerAssignment([member('a'), candidate], 'a', candidate.userId);
            expect(r.ok).toBe(false);
            expect(r.reason).toBe(reason);
        });
        expect(R.validateManagerAssignment([member('a')], 'a', 'ghost').reason).toBe(R.REASON.UNKNOWN);
    });

    test('an agent or api-token actor can never be a manager or a report', () => {
        const actors = [
            member('bot', { isAgent: true }),
            member('run', { agentId: 'ag_1' }),
            member('tok', { apiTokenId: 'tk_1' }),
            member('ghost', { ghostUser: true })
        ];
        actors.forEach((actor) => {
            expect(R.validateManagerAssignment([member('a'), actor], 'a', actor.userId).reason).toBe(R.REASON.NOT_A_PERSON);
            expect(R.validateManagerAssignment([actor, member('a')], actor.userId, 'a').reason).toBe(R.REASON.NOT_A_PERSON);
        });
    });

    test('an unknown subject is refused rather than silently created', () => {
        expect(R.validateManagerAssignment([member('a')], 'nobody', 'a').reason).toBe(R.REASON.NO_SUBJECT);
    });
});

describe('reassignReports', () => {
    test('reports inherit the departing member\'s own manager', () => {
        const moves = R.reassignReports(chain(), 'b');
        expect(moves).toEqual([{ userId: 'a', docId: 'doc_a', managerId: 'c' }]);
    });

    test('reports of a top-level departure lose the line rather than keeping a dead pointer', () => {
        const moves = R.reassignReports(chain(), 'c');
        expect(moves).toEqual([{ userId: 'b', docId: 'doc_b', managerId: '' }]);
    });

    test('an inherited manager who is themselves inactive is not handed down', () => {
        const people = [
            member('a', { managerId: 'b' }),
            member('b', { managerId: 'c' }),
            member('c', { status: 3, isDelete: true })
        ];
        expect(R.reassignReports(people, 'b')).toEqual([{ userId: 'a', docId: 'doc_a', managerId: '' }]);
    });

    test('nothing to do when the departing member has no reports', () => {
        expect(R.reassignReports(chain(), 'a')).toEqual([]);
        expect(R.reassignReports(chain(), 'nobody')).toEqual([]);
    });
});

describe('buildOrgTree', () => {
    const ids = (nodes) => nodes.map((n) => n.id);

    test('an empty workspace and one with no manager recorded are both flat forests', () => {
        expect(R.buildOrgTree([])).toEqual({ roots: [], cycleIds: [], managed: 0 });
        const flat = R.buildOrgTree([member('a'), member('b')]);
        expect(ids(flat.roots)).toEqual(['a', 'b']);
        expect(flat.managed).toBe(0);
    });

    test('nests a chain under its single root', () => {
        const tree = R.buildOrgTree(chain());
        expect(ids(tree.roots)).toEqual(['c']);
        expect(ids(tree.roots[0].reports)).toEqual(['b']);
        expect(ids(tree.roots[0].reports[0].reports)).toEqual(['a']);
        expect(tree.managed).toBe(2);
    });

    test('handles a forest, not just one root', () => {
        const people = [member('a', { managerId: 'b' }), member('b'), member('c', { managerId: 'd' }), member('d')];
        const tree = R.buildOrgTree(people);
        expect(ids(tree.roots)).toEqual(['b', 'd']);
    });

    test('a report whose manager is gone, guest or an agent becomes a root', () => {
        const people = [
            member('a', { managerId: 'gone' }),
            member('b', { managerId: 'g' }),
            member('g', { roleType: 0 }),
            member('c', { managerId: 'bot' }),
            member('bot', { isAgent: true })
        ];
        const tree = R.buildOrgTree(people);
        expect(ids(tree.roots)).toEqual(['a', 'b', 'c']);
    });

    test('a cycle that reached storage is cut loose instead of hanging', () => {
        const people = [
            member('a', { managerId: 'b' }),
            member('b', { managerId: 'c' }),
            member('c', { managerId: 'a' }),
            member('d')
        ];
        const tree = R.buildOrgTree(people);
        expect(ids(tree.roots)).toEqual(['d', 'a']);
        expect(tree.cycleIds).toEqual(['a']);
        const seen = [];
        const walk = (node) => { seen.push(node.id); node.reports.forEach(walk); };
        tree.roots.forEach(walk);
        expect(seen.sort()).toEqual(['a', 'b', 'c', 'd']);
    });

    test('everyone appears exactly once', () => {
        const people = [member('a', { managerId: 'c' }), member('b', { managerId: 'c' }), member('c'), member('d')];
        const seen = [];
        const walk = (node) => { seen.push(node.id); node.reports.forEach(walk); };
        R.buildOrgTree(people).roots.forEach(walk);
        expect(seen.sort()).toEqual(['a', 'b', 'c', 'd']);
    });
});
