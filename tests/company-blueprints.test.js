const data = require('../Modules/Agents/companyBlueprints.json');
const playbooks = require('../Modules/Agents/rolePlaybooks');
const blueprints = require('../Modules/Agents/companyBlueprints');

const view = blueprints.view();
const industry = (id) => view.find((one) => one.id === id);

describe('company blueprints data', () => {
    it('has the eight industries of the plan, each with the three sizes', () => {
        expect(view.map((one) => one.id)).toEqual(['it-company', 'manufacturing', 'agency', 'ecommerce', 'construction', 'professional-services', 'education', 'clinic-admin']);
        view.forEach((one) => expect(Object.keys(one.sizes)).toEqual(blueprints.SIZES));
    });

    it('names only playbooks that exist, and unwritten roles carry a name and a team', () => {
        const slugs = new Set(playbooks.all().map((role) => role.slug));
        data.industries.forEach((one) => {
            const seen = new Set();
            one.roles.forEach((role) => {
                if (role.slug) expect(slugs.has(role.slug)).toBe(true);
                else expect(role.name && role.team).toBeTruthy();
                const label = role.slug || role.name;
                expect(seen.has(label)).toBe(false);
                seen.add(label);
            });
        });
    });

    it('grows roles, seats and people with the size, and never lists more roles than the industry has', () => {
        data.industries.forEach((one) => {
            const [small, medium, large] = blueprints.SIZES.map((size) => one.sizes[size]);
            [small, medium, large].forEach((size) => {
                expect(size.roles).toBeLessThanOrEqual(one.roles.length);
                expect(size.seats[0]).toBeLessThanOrEqual(size.seats[1]);
                expect(size.people[0]).toBeLessThan(size.people[1]);
            });
            expect(small.roles).toBeLessThanOrEqual(medium.roles);
            expect(medium.roles).toBeLessThanOrEqual(large.roles);
            expect(small.seats[1]).toBeLessThanOrEqual(large.seats[1]);
            expect(small.people[1]).toBe(medium.people[0]);
            expect(medium.people[1]).toBe(large.people[0]);
        });
    });

    it('starts an IT company with the Bug Triager, Support Agent and Tech Lead, and a plant with Order Intake, Non-conformance Recorder and Maintenance Planner', () => {
        expect(industry('it-company').sizes.medium.starter).toEqual(['Bug Triager', 'Support Agent', 'Tech Lead']);
        expect(industry('manufacturing').sizes.large.starter).toEqual(['Order Intake', 'Non-conformance Recorder', 'Maintenance Planner']);
    });

    it('offers the first three roles to the pack route by blueprint and team, and only those that are written', () => {
        const it = industry('it-company').sizes.small.packs;
        expect(it).toEqual([{ blueprint: 'it-company', teams: ['engineering', 'support'], roles: ['it-company/bug-triager', 'it-company/support-agent', 'it-company/tech-lead'] }]);
        const agency = industry('agency').sizes.small;
        expect(agency.starter).toEqual(['Content Writer', 'Social Media Manager', 'Account Manager']);
        expect(agency.packs).toEqual([{ blueprint: 'it-company', teams: ['sales'], roles: ['it-company/account-manager'] }]);
        expect(industry('clinic-admin').sizes.small.packs).toEqual([]);
    });

    it('lists roles in the data order and the teams they sit in', () => {
        const small = industry('it-company').sizes.small;
        expect(small.roles.map((role) => role.name).slice(0, 4)).toEqual(['Bug Triager', 'Support Agent', 'Tech Lead', 'QA Engineer']);
        expect(small.teams).toEqual(expect.arrayContaining(['engineering', 'support']));
    });
});
