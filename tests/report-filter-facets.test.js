const F = require('../frontend/src/views/Timesheet/report/reportFacets');
const Q = require('../frontend/src/views/Timesheet/report/reportQuery');

const projects = [
    { _id: 'p1', AssigneeUserId: ['ann', 'bob'] },
    { _id: 'p2', AssigneeUserId: ['ann'] },
    { _id: 'p3', AssigneeUserId: ['tId_t9'] },
    { _id: 'p4', AssigneeUserId: [] },
];

describe('filter options narrowed by the chosen people (task 086)', () => {
    it('counts a project for a person who is on it, on it through a team, or worked in it', () => {
        const ids = F.projectsOfPerson('cat', { projects, workedByUser: { cat: ['p4'] }, teamsOfUser: { cat: ['t9'] } });
        expect([...ids].sort()).toEqual(['p3', 'p4']);
    });

    it('takes any of the people as the union and all of them as the intersection', () => {
        const data = { projects, workedByUser: { bob: ['p4'] }, teamsOfUser: {} };
        expect([...F.projectsForPeople({ people: ['ann', 'bob'], match: 'any', ...data })].sort()).toEqual(['p1', 'p2', 'p4']);
        expect([...F.projectsForPeople({ people: ['ann', 'bob'], match: 'all', ...data })]).toEqual(['p1']);
        expect(F.projectsForPeople({ people: [], ...data })).toBeNull();
    });

    it('takes the other filters from the chosen projects, else the people\'s, else every project', () => {
        const all = projects;
        expect(F.basisProjects({ chosen: ['p2'], allowed: new Set(['p1']), all }).map((p) => p._id)).toEqual(['p2']);
        expect(F.basisProjects({ chosen: [], allowed: new Set(['p1', 'p3']), all }).map((p) => p._id)).toEqual(['p1', 'p3']);
        expect(F.basisProjects({ chosen: [], allowed: null, all })).toHaveLength(4);
    });

    it('keeps a picked option listed even when the narrowing would drop it, and lists picked options first', () => {
        const options = [{ value: 'a' }, { value: 'b' }, { value: 'c' }];
        expect(F.keepAllowed(options, new Set(['b']), ['c']).map((o) => o.value)).toEqual(['b', 'c']);
        expect(F.keepAllowed(options, null)).toBe(options);
        expect(F.pickedFirst(options, ['c', 'b']).map((o) => o.value)).toEqual(['b', 'c', 'a']);
    });

    it('keeps "all" in the URL only when it means something, and carries it to other tabs', () => {
        expect(Q.writeFilters({ ...Q.emptyFilters(), people: ['a', 'b'], match: 'all' }, {})).toMatchObject({ match: 'all' });
        expect(Q.writeFilters({ ...Q.emptyFilters(), people: ['a'], match: 'all' }, {}).match).toBeUndefined();
        expect(Q.readFilters({ match: 'nonsense' }).match).toBe('any');
        expect(Q.readFilters({ match: 'all', people: ['a', 'b'] }).match).toBe('all');
        expect(Q.sharedQuery({ match: 'all', status: ['x'] })).toEqual({ match: 'all' });
    });
});
