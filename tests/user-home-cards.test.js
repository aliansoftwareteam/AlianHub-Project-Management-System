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

    it('keeps homeCards.layout as an ordered list of names', () => {
        expect(new Users({ homeCards: { layout: ['recents', 'waiting'] } }).toObject().homeCards.layout).toEqual(['recents', 'waiting']);
    });

    it('leaves a user who never arranged Home without a layout', () => {
        expect(new Users({}).toObject().homeCards?.layout).toBeUndefined();
    });
});

describe('every Home card the page offers can be saved', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'Home', 'homeCards.js'), 'utf8');
    const ownIds = [...source.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
    const catalogList = (source.match(/HOME_CATALOG_KEYS = Object\.freeze\(\[([^\]]*)\]/) || [])[1] || '';
    const catalogIds = [...catalogList.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

    it('finds the Home cards and the dashboard cards (the scan works)', () => {
        expect(ownIds).toContain('recents');
        expect(catalogIds.length).toBeGreaterThan(1);
    });
    it.each([...ownIds, ...catalogIds])('%s is a known id', (id) => { expect(HOME_CARD_IDS).toContain(id); });
});

describe('sanitizeHomeCards', () => {
    it('turns a list of known ids into a $set on the caller\'s record', () => {
        expect(sanitizeHomeCards({ hidden: ['standup'] })).toEqual({ ok: true, field: 'hidden', update: { $set: { 'homeCards.hidden': ['standup'] } } });
    });

    it('accepts showing every card again', () => {
        expect(sanitizeHomeCards({ hidden: [] })).toEqual({ ok: true, field: 'hidden', update: { $set: { 'homeCards.hidden': [] } } });
    });

    it('stores a layout in order and drops the old hidden list', () => {
        expect(sanitizeHomeCards({ layout: ['recents', 'DueSoonCard', 'waiting'] })).toEqual({
            ok: true,
            field: 'layout',
            update: { $set: { 'homeCards.layout': ['recents', 'DueSoonCard', 'waiting'] }, $unset: { 'homeCards.hidden': '' } },
        });
    });

    it('accepts an empty Home', () => {
        expect(sanitizeHomeCards({ layout: [] }).update.$set).toEqual({ 'homeCards.layout': [] });
    });

    it('skips an unknown or retired card and a repeat instead of refusing the layout', () => {
        expect(sanitizeHomeCards({ layout: ['standup', 'RetiredCard', 'standup', 'recents'] }).update.$set)
            .toEqual({ 'homeCards.layout': ['standup', 'recents'] });
    });

    it.each([
        ['a layout that is not a list', { layout: 'recents' }],
        ['a layout entry that is not a name', { layout: ['recents', { id: 'waiting' }] }],
        ['an overlong layout', { layout: Array.from({ length: 41 }, (_, i) => `card${i}`) }],
        ['a layout and a hidden list together', { layout: [], hidden: [] }],
    ])('refuses %s', (_name, body) => {
        expect(sanitizeHomeCards(body).ok).toBe(false);
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

    it('saves the layout and returns it as stored', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: UID, homeCards: { layout: ['recents', 'MyTimeCard'] } });
        const res = resOf();
        await updateOwnHomeCards({ uid: UID, body: { layout: ['recents', 'MyTimeCard'] } }, res);
        const [, query] = MongoDbCrudOpration.mock.calls[0];
        expect(String(query.data[0]._id)).toBe(UID);
        expect(query.data[1]).toEqual({ $set: { 'homeCards.layout': ['recents', 'MyTimeCard'] }, $unset: { 'homeCards.hidden': '' } });
        expect(res.json.mock.calls[0][0]).toEqual({ status: true, statusText: 'Home cards saved', data: { layout: ['recents', 'MyTimeCard'] } });
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

    it('includes the saved layout in the self view', () => {
        expect(toSelfView({ _id: UID, homeCards: { layout: ['recents'] } }).homeCards).toEqual({ layout: ['recents'] });
    });
});
