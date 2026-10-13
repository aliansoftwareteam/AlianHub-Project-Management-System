const fs = require('fs');
const path = require('path');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => ({})) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));
jest.mock('../Modules/MainChats/controller', () => ({ updateMainChat: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { importCompanyRoles } = require('../utils/data');
const roleTypes = require('../Config/roleTypes');
const { isPrivileged } = roleTypes;
const { GUEST_ROLE } = require('../Modules/Users/helpers/reportingLine');
const approvalRules = require('../Modules/TimesheetApproval/helpers/approvalRules');

const seededRoles = async () => {
    MongoDbCrudOpration.mockClear();
    await importCompanyRoles('c1');
    const [, query] = MongoDbCrudOpration.mock.calls[0];
    return query.data[1].$set.settings;
};

describe('role catalogue', () => {
    it('seeds Guest 0, Owner 1, Admin 2, Member 3', async () => {
        expect(await seededRoles()).toEqual([
            { name: 'Guest', key: 0 },
            { name: 'Owner', key: 1 },
            { name: 'Admin', key: 2 },
            { name: 'Member', key: 3 },
        ]);
    });

    it('matches the shared backend constants', async () => {
        const byName = Object.fromEntries((await seededRoles()).map((role) => [role.name, role.key]));
        expect(roleTypes).toMatchObject({
            ROLE_GUEST: byName.Guest,
            ROLE_OWNER: byName.Owner,
            ROLE_ADMIN: byName.Admin,
            ROLE_MEMBER: byName.Member,
        });
        expect(GUEST_ROLE).toBe(byName.Guest);
        expect([approvalRules.ROLE_OWNER, approvalRules.ROLE_ADMIN]).toEqual([byName.Owner, byName.Admin]);
    });

    it('matches the frontend constants', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'utils', 'roles.js'), 'utf8');
        const frontend = Object.fromEntries([...source.matchAll(/export const (ROLE_\w+) = (\d+);/g)].map(([, name, value]) => [name, Number(value)]));
        const backend = Object.fromEntries(Object.entries(roleTypes).filter(([name]) => name.startsWith('ROLE_')));
        expect(frontend).toEqual(backend);
    });

    it('treats only owner and admin as privileged', () => {
        expect([0, 1, 2, 3, 4, null, undefined, '1'].map(isPrivileged)).toEqual([false, true, true, false, false, false, false, false]);
    });

    it('lets only owner and admin review timesheets', () => {
        expect([0, 1, 2, 3].map((roleType) => approvalRules.canReview({ roleType }))).toEqual([false, true, true, false]);
    });
});
