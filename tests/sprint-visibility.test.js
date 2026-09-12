const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const {
    canSeeSprint,
    canSeeSprintById,
    hiddenSprintIds,
    sprintIdentities,
    visibleSprintClause,
    visibleSprintExpr,
} = require('../Modules/Sprints/helpers/sprintVisibility');

const C = '6f0000000000000000000f01';
const OWNER = '6f0000000000000000000f11';
const MEMBER = '6f0000000000000000000f12';
const OUTSIDER = '6f0000000000000000000f13';
const PROJECT = '6f0000000000000000000f21';

const team = (members) => mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { name: 'Core', assigneeUsersArray: members });
const sprint = (over) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { projectId: PROJECT, private: false, AssigneeUserId: [], ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
});

describe('sprintIdentities expands the caller into their user id and team ids', () => {
    it('returns the user id alone when they are on no team', async () => {
        expect(await sprintIdentities(C, MEMBER)).toEqual([MEMBER]);
    });

    it('adds a tId_ entry for each team the caller belongs to', async () => {
        const core = team([MEMBER]);
        expect(await sprintIdentities(C, MEMBER)).toEqual([MEMBER, `tId_${core._id}`]);
        expect(await sprintIdentities(C, OUTSIDER)).toEqual([OUTSIDER]);
    });

    it('reads the teams once and serves the rest of the request from cache', async () => {
        team([MEMBER]);
        const before = mockDb.calls.length;
        await sprintIdentities(C, MEMBER);
        await sprintIdentities(C, MEMBER);
        await sprintIdentities(C, MEMBER);
        expect(mockDb.calls.length - before).toBe(1);
    });
});

describe('canSeeSprint recognises a team assignment', () => {
    it('lets a public sprint through for anyone', () => {
        expect(canSeeSprint({ private: false, AssigneeUserId: [OWNER] }, [OUTSIDER])).toBe(true);
    });

    it('refuses a private sprint the caller has no identity on', () => {
        expect(canSeeSprint({ private: true, AssigneeUserId: [OWNER, 'tId_1'] }, [OUTSIDER])).toBe(false);
    });

    it('accepts a private sprint assigned to a team the caller is on', () => {
        expect(canSeeSprint({ private: true, AssigneeUserId: ['tId_7'] }, [MEMBER, 'tId_7'])).toBe(true);
    });
});

describe('hiddenSprintIds and canSeeSprintById follow team assignments', () => {
    it('keeps a private sprint assigned to the caller\'s team out of the hidden list', async () => {
        const core = team([MEMBER]);
        const shared = sprint({ private: true, AssigneeUserId: [`tId_${core._id}`] });
        const secret = sprint({ private: true, AssigneeUserId: [OWNER] });

        const hidden = (await hiddenSprintIds(C, MEMBER, [PROJECT])).map(String);
        expect(hidden).toEqual([String(secret._id)]);
        expect(hidden).not.toContain(String(shared._id));

        expect((await hiddenSprintIds(C, OUTSIDER, [PROJECT])).map(String).sort())
            .toEqual([String(shared._id), String(secret._id)].sort());
    });

    it('answers canSeeSprintById for a member of an assigned team', async () => {
        const core = team([MEMBER]);
        const shared = sprint({ private: true, AssigneeUserId: [`tId_${core._id}`] });
        expect(await canSeeSprintById(C, MEMBER, shared._id)).toBe(true);
        expect(await canSeeSprintById(C, OUTSIDER, shared._id)).toBe(false);
    });
});

describe('the query and aggregation forms carry the same identities', () => {
    it('matches a public sprint or one assigned to any of the identities', () => {
        expect(visibleSprintClause([MEMBER, 'tId_7'], 'sprintArray.')).toEqual({
            $or: [
                { 'sprintArray.private': { $ne: true } },
                { 'sprintArray.AssigneeUserId': { $in: [MEMBER, 'tId_7'] } },
            ],
        });
    });

    it('intersects the assignee list with the identities as an expression', () => {
        expect(visibleSprintExpr([MEMBER, 'tId_7'])).toEqual({
            $or: [
                { $ne: ['$private', true] },
                { $gt: [{ $size: { $setIntersection: [{ $ifNull: ['$AssigneeUserId', []] }, [MEMBER, 'tId_7']] } }, 0] },
            ],
        });
    });
});
