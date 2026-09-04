const { computeSetupStatus, validateSetupPayload, MIN_PASSWORD } = require('../Modules/Setup/helpers');
const { TEAM_FOCUS_OPTIONS } = require('../utils/sampleTasks');
const { version } = require('../package.json');

describe('setup status — what the wizard learns from the server', () => {
    it('is installed only when the database answers and a user exists', () => {
        expect(computeSetupStatus({ db: { ok: true }, userCount: 1 })).toMatchObject({ installed: true, dbOk: true, dbError: null, version });
        expect(computeSetupStatus({ db: { ok: true }, userCount: 0 })).toMatchObject({ installed: false, dbOk: true });
    });

    it('reports the database error and never claims installed while the database is down', () => {
        const out = computeSetupStatus({ db: { ok: false, error: 'MONGODB_URL is not set' }, userCount: 5 });
        expect(out).toMatchObject({ installed: false, dbOk: false, dbError: 'MONGODB_URL is not set' });
        expect(computeSetupStatus({ db: { ok: false }, userCount: 0 }).dbError).toBeTruthy();
    });
});

describe('setup payload validation', () => {
    const good = { firstName: ' Ada ', lastName: 'Lovelace', email: 'Ada@Example.com', password: 'correct horse', companyName: 'Analytical Engines' };

    it('trims, lowercases the email, and defaults sample data to on', () => {
        const { data, errors, valid } = validateSetupPayload(good);
        expect(valid).toBe(true);
        expect(errors).toEqual({});
        expect(data).toMatchObject({ firstName: 'Ada', email: 'ada@example.com', sampleData: true, teamFocus: '' });
    });

    it('names every missing or bad field at once', () => {
        const { errors, valid } = validateSetupPayload({ email: 'nope', password: 'short' });
        expect(valid).toBe(false);
        expect(errors).toEqual({ firstName: 'required', lastName: 'required', email: 'invalid', password: `min_${MIN_PASSWORD}`, companyName: 'required' });
    });

    it('accepts the sample toggle as a boolean or the string the form sends', () => {
        expect(validateSetupPayload({ ...good, sampleData: false }).data.sampleData).toBe(false);
        expect(validateSetupPayload({ ...good, sampleData: 'false' }).data.sampleData).toBe(false);
        expect(validateSetupPayload({ ...good, sampleData: 'true' }).data.sampleData).toBe(true);
    });

    it('only accepts a team focus the sample content knows', () => {
        expect(validateSetupPayload({ ...good, teamFocus: TEAM_FOCUS_OPTIONS[0] }).valid).toBe(true);
        expect(validateSetupPayload({ ...good, teamFocus: 'astrology' }).errors.teamFocus).toBe('invalid');
    });
});
