jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { usersSchema } = require('../utils/mongo-handler/createSchema');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { sanitizeOnboardingPatch, ONBOARDING_FLAGS } = require('../Modules/Users/helpers/onboardingRules');
const { updateOwnOnboarding } = require('../Modules/Users/onboarding');

const UID = '64b000000000000000000001';
const OTHER_UID = '64b000000000000000000002';

const resOf = () => {
    const res = { status: jest.fn(() => res), json: jest.fn() };
    return res;
};

describe('the user schema keeps the onboarding record', () => {
    it.each(ONBOARDING_FLAGS)('declares homeChecklist.%s as a boolean', (flag) => {
        expect(usersSchema.path(`homeChecklist.${flag}`)).toBeDefined();
        expect(usersSchema.path(`homeChecklist.${flag}`).instance).toBe('Boolean');
    });

    it('declares the tours already offered as a list of names', () => {
        expect(usersSchema.path('homeChecklist.toursOffered')).toBeDefined();
        expect(usersSchema.path('homeChecklist.toursOffered').instance).toBe('Array');
    });
});

describe('sanitizeOnboardingPatch', () => {
    it('turns known flags into a $set on the caller\'s record', () => {
        expect(sanitizeOnboardingPatch({ dismissed: true, openedProject: true })).toEqual({
            ok: true,
            update: { $set: { 'homeChecklist.dismissed': true, 'homeChecklist.openedProject': true } }
        });
    });

    it('adds an offered tour once', () => {
        expect(sanitizeOnboardingPatch({ tourOffered: 'project' })).toEqual({ ok: true, update: { $addToSet: { 'homeChecklist.toursOffered': 'project' } } });
    });

    it.each([
        ['an empty body', {}],
        ['a body that is not an object', 'dismissed'],
        ['a list', [true]],
        ['an unknown field', { dismissed: true, isProductOwner: true }],
        ['someone else\'s id', { userId: OTHER_UID, dismissed: true }],
        ['a flag that is not a boolean', { dismissed: 'yes' }],
        ['an operator', { $set: { dismissed: true } }],
        ['an unknown tour', { tourOffered: 'admin' }]
    ])('refuses %s', (_name, body) => {
        expect(sanitizeOnboardingPatch(body).ok).toBe(false);
    });
});

describe('PUT /api/v2/users/onboarding', () => {
    beforeEach(() => {
        MongoDbCrudOpration.mockReset();
        MongoDbCrudOpration.mockResolvedValue({ _id: UID, homeChecklist: { dismissed: true } });
    });

    it('refuses a caller without a session', async () => {
        const res = resOf();
        await updateOwnOnboarding({ body: { dismissed: true } }, res);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('writes only to the signed-in user, whatever id the body names', async () => {
        const res = resOf();
        await updateOwnOnboarding({ uid: UID, body: { dismissed: true } }, res);
        const [scope, query, method] = MongoDbCrudOpration.mock.calls[0];
        expect(scope).toBe(SCHEMA_TYPE.GOLBAL);
        expect(query.type).toBe(SCHEMA_TYPE.USERS);
        expect(method).toBe('findOneAndUpdate');
        expect(String(query.data[0]._id)).toBe(UID);
        expect(query.data[1]).toEqual({ $set: { 'homeChecklist.dismissed': true } });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json.mock.calls[0][0]).toEqual({ status: true, statusText: 'Onboarding saved', data: { dismissed: true } });
    });

    it('answers 400 and writes nothing for a bad patch', async () => {
        const res = resOf();
        await updateOwnOnboarding({ uid: UID, body: { userId: OTHER_UID, dismissed: true } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });
});
