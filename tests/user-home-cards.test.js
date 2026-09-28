jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { schema } = require('../utils/mongo-handler/schema.js');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { toSelfView } = require('../Modules/Users/helpers/userAccessRules');
const { HOME_CARD_IDS, sanitizeHomeCards } = require('../Modules/Users/helpers/homeCardsRules');
const { updateOwnHomeCards } = require('../Modules/Users/homeCards');

const UID = '64b000000000000000000001';
const OTHER_UID = '64b000000000000000000002';
const ROUTE = '/api/v2/users/home-cards';

const resOf = () => {
    const res = { status: jest.fn(() => res), json: jest.fn() };
    return res;
};

describe('the hidden Home cards survive the strict user schema', () => {
    const Users = mongoose.models.HomeCardsUser || mongoose.model('HomeCardsUser', new mongoose.Schema(schema.users, { strict: true, timestamps: true }));

    it('keeps homeCards.hidden as a list of names', () => {
        expect(new Users({ homeCards: { hidden: ['standup'] } }).toObject().homeCards.hidden).toEqual(['standup']);
    });

    it('leaves a user who never hid a card without a value', () => {
        expect(new Users({}).toObject().homeCards?.hidden).toBeUndefined();
    });
});

describe('every Home card the page offers can be hidden', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'Home', 'homeCards.js'), 'utf8');
    const ids = [...source.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);

    it('finds the cards (the scan works)', () => { expect(ids.length).toBeGreaterThan(1); });
    it.each(ids)('%s is a known id', (id) => { expect(HOME_CARD_IDS).toContain(id); });
});

describe('sanitizeHomeCards', () => {
    it('turns a list of known ids into a $set on the caller\'s record', () => {
        expect(sanitizeHomeCards({ hidden: ['standup'] })).toEqual({ ok: true, update: { $set: { 'homeCards.hidden': ['standup'] } } });
    });

    it('accepts showing every card again', () => {
        expect(sanitizeHomeCards({ hidden: [] })).toEqual({ ok: true, update: { $set: { 'homeCards.hidden': [] } } });
    });

    it.each([
        ['an empty body', {}],
        ['a body that is not an object', 'standup'],
        ['a list', ['standup']],
        ['hidden that is not a list', { hidden: 'standup' }],
        ['an unknown card', { hidden: ['standup', 'billing'] }],
        ['the same card twice', { hidden: ['standup', 'standup'] }],
        ['an unknown field', { hidden: [], theme: 'dark' }],
        ['someone else\'s id', { userId: OTHER_UID, hidden: [] }],
        ['an operator', { $set: { 'homeCards.hidden': [] } }],
    ])('refuses %s', (_name, body) => {
        expect(sanitizeHomeCards(body).ok).toBe(false);
    });
});

describe(`PUT ${ROUTE}`, () => {
    beforeEach(() => {
        MongoDbCrudOpration.mockReset();
        MongoDbCrudOpration.mockResolvedValue({ _id: UID, homeCards: { hidden: ['waiting'] } });
    });

    it('is registered and needs a signed-in session', () => {
        const routes = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Users', 'routes.js'), 'utf8');
        const middleware = fs.readFileSync(path.join(__dirname, '..', 'Config', 'setMiddleware.js'), 'utf8');
        expect(routes).toContain(`app.put('${ROUTE}', homeCards.updateOwnHomeCards)`);
        expect(middleware).toContain(`"${ROUTE}"`);
    });

    it('refuses a caller without a session', async () => {
        const res = resOf();
        await updateOwnHomeCards({ body: { hidden: [] } }, res);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('writes only to the signed-in user and returns what was stored', async () => {
        const res = resOf();
        await updateOwnHomeCards({ uid: UID, body: { hidden: ['waiting'] } }, res);
        const [scope, query, method] = MongoDbCrudOpration.mock.calls[0];
        expect(scope).toBe(SCHEMA_TYPE.GOLBAL);
        expect(query.type).toBe(SCHEMA_TYPE.USERS);
        expect(method).toBe('findOneAndUpdate');
        expect(Object.keys(query.data[0])).toEqual(['_id']);
        expect(String(query.data[0]._id)).toBe(UID);
        expect(query.data[1]).toEqual({ $set: { 'homeCards.hidden': ['waiting'] } });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json.mock.calls[0][0]).toEqual({ status: true, statusText: 'Home cards saved', data: { hidden: ['waiting'] } });
    });

    it('answers 400 and writes nothing for an invalid shape', async () => {
        const res = resOf();
        await updateOwnHomeCards({ uid: UID, body: { hidden: ['nope'] } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers 404 when the caller\'s record is gone', async () => {
        MongoDbCrudOpration.mockResolvedValue(null);
        const res = resOf();
        await updateOwnHomeCards({ uid: UID, body: { hidden: [] } }, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });
});

describe('the caller reads the hidden cards back on their own record', () => {
    it('includes homeCards in the self view', () => {
        expect(toSelfView({ _id: UID, homeCards: { hidden: ['standup'] } }).homeCards).toEqual({ hidden: ['standup'] });
    });
});
