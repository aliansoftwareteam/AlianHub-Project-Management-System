const mongoose = require('mongoose');
const { LIST_PLACEMENT_KEYS, listPlacement } = require('../utils/mongo-handler/listPlacement');

const HEX = 'a1b2c3d4e5f60718293a4b5c';
const HEX2 = '0123456789abcdef01234567';

describe('listPlacement', () => {
    test('a whole stored list is cut down to its id, folder and the two names', () => {
        const placed = listPlacement({ _id: HEX, name: 'Sprint 1', folderId: HEX2, folderName: 'Q1', AssigneeUserId: ['u1'], counters: { open: 4 }, isBacklog: false });
        expect(Object.keys(placed).sort()).toEqual(['folderId', 'folderName', 'id', 'name']);
        expect(placed.name).toBe('Sprint 1');
        expect(placed.folderName).toBe('Q1');
    });

    test('a stored list names itself by _id, which becomes the id as an ObjectId', () => {
        const placed = listPlacement({ _id: HEX, name: 'A' });
        expect(placed.id).toBeInstanceOf(mongoose.Types.ObjectId);
        expect(String(placed.id)).toBe(HEX);
    });

    test('an id that is already given wins over _id', () => {
        expect(String(listPlacement({ id: HEX2, _id: HEX }).id)).toBe(HEX2);
    });

    test('an id or folder id that is not a 24-character hex string is kept as sent', () => {
        expect(listPlacement({ id: 'legacy-7', folderId: 'f-1' })).toEqual({ id: 'legacy-7', folderId: 'f-1' });
    });

    test('a key that is missing is not added as undefined', () => {
        expect(listPlacement({ name: 'Only a name' })).toEqual({ name: 'Only a name' });
    });

    test('a bare value from a dotted update is passed through untouched', () => {
        expect(listPlacement('Renamed')).toBe('Renamed');
        expect(listPlacement(HEX)).toBe(HEX);
        expect(listPlacement(null)).toBeNull();
        expect(listPlacement(undefined)).toBeUndefined();
        expect(listPlacement(7)).toBe(7);
    });

    test('an array, a date and an ObjectId are not read as a list', () => {
        const oid = new mongoose.Types.ObjectId(HEX);
        const date = new Date(0);
        const array = [{ id: HEX }];
        expect(listPlacement(oid)).toBe(oid);
        expect(listPlacement(date)).toBe(date);
        expect(listPlacement(array)).toBe(array);
    });

    test('the keys it keeps are exactly those the readers match on', () => {
        expect(LIST_PLACEMENT_KEYS).toEqual(['id', 'name', 'folderId', 'folderName']);
        expect(Object.isFrozen(LIST_PLACEMENT_KEYS)).toBe(true);
    });
});
