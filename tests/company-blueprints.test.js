const fs = require('fs');
const path = require('path');
const data = require('../Modules/Agents/companyBlueprints.json');
const playbooks = require('../Modules/Agents/rolePlaybooks');
const blueprints = require('../Modules/Agents/companyBlueprints');

const view = blueprints.view();
const industry = (id) => view.find((one) => one.id === id);

describe('company blueprints data', () => {
    it('has the eight industries of the plan, each with the three sizes', () => {
        expect(view.map((one) => one.id)).toEqual(['it-company', 'manufacturing', 'agency', 'ecommerce', 'construction', 'professional-services', 'education', 'clinic']);
        view.forEach((one) => expect(Object.keys(one.sizes)).toEqual(blueprints.SIZES));
    });

    it('names only playbooks that exist, and flags every suggested role that has none', () => {
        const slugs = new Set(playbooks.all().map((role) => role.slug));
        data.industries.forEach((one) => {
            const seen = new Set();
            one.roles.forEach((role) => {
                if (role.slug) {
                    expect({ industry: one.id, slug: role.slug, exists: slugs.has(role.slug) }).toEqual({ industry: one.id, slug: role.slug, exists: true });
                    expect(role.notWritten).toBeUndefined();
                } else {
                    expect(role).toEqual({ name: expect.any(String), team: expect.any(String), notWritten: true });
                }
                const label = role.slug || role.name;
                expect(seen.has(label)).toBe(false);
                seen.add(label);
            });
        });
    });

    it('has an entry for every blueprint folder of role playbooks', () => {
        const folders = fs.readdirSync(path.join(__dirname, '../Modules/Agents/roles'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
        expect(folders.length).toBeGreaterThan(0);
        expect(folders.filter((folder) => !data.industries.some((one) => one.id === folder))).toEqual([]);
    });

    it('starts every blueprint with at least three written roles', () => {
        data.industries.forEach((one) => {
            const starter = one.roles.slice(0, blueprints.STARTER);
            expect({ industry: one.id, written: starter.filter((role) => role.slug).length }).toEqual({ industry: one.id, written: blueprints.STARTER });
        });
        view.forEach((one) => blueprints.SIZES.forEach((size) => {
            expect(one.sizes[size].packs.flatMap((pack) => pack.roles)).toHaveLength(blueprints.STARTER);
        }));
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

    it('offers the first three roles to the pack route by blueprint and team', () => {
        const it = industry('it-company').sizes.small.packs;
        expect(it).toEqual([{ blueprint: 'it-company', teams: ['engineering', 'support'], roles: ['it-company/bug-triager', 'it-company/support-agent', 'it-company/tech-lead'] }]);
        const agency = industry('agency').sizes.small;
        expect(agency.starter).toEqual(['Agency Content Writer', 'Agency Social Media Manager', 'Agency Account Manager']);
        expect(agency.packs).toEqual([{ blueprint: 'agency', teams: ['creative', 'client-services'], roles: ['agency/content-writer', 'agency/social-media-manager', 'agency/agency-account-manager'] }]);
        expect(industry('clinic').sizes.small.packs).toEqual([{ blueprint: 'clinic', teams: ['front-desk', 'supplies', 'staff-rosters'], roles: ['clinic/appointment-follow-up-list', 'clinic/clinic-supplies-stock-alert', 'clinic/staff-roster-checker'] }]);
    });

    it('lists roles in the data order and the teams they sit in', () => {
        const small = industry('it-company').sizes.small;
        expect(small.roles.map((role) => role.name).slice(0, 4)).toEqual(['Bug Triager', 'Support Agent', 'Tech Lead', 'QA Engineer']);
        expect(small.teams).toEqual(expect.arrayContaining(['engineering', 'support']));
    });
});
