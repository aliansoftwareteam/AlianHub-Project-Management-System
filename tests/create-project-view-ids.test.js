/* A project's view entries carry the `_id` of the company's project_tab_components row, as a
   string, and the project view bar reads that id's length to tell a view (24 characters) from
   an embed (6). The category merge matched catalogue rows by name and fell through to the raw
   template entry when none matched, so a company whose catalogue holds no "Board" row stored
   the blank template's Board view with no `_id` at all — and Projects.vue threw on it, leaving
   the project with no view bar and no task list. */
const fs = require('fs');
const path = require('path');

const blankTemplate = require('../Modules/createProject/blankTemplate');
const { withViewId, withViewIds, isMissingViewId, VIEW_ID_LENGTH } = require('../Modules/createProject/viewEntries');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'createProject', 'controller.js'), 'utf8');

const LIST_ROW = { _id: '6a97261fb28e840202058560', keyName: 'ProjectListView', name: 'List' };
const GANTT_ROW = { _id: '6a97261fb28e840202058561', keyName: 'GanttView', name: 'Gantt View' };
const BOARD_ROW = { _id: '6a97261fb28e840202058562', keyName: 'ProjectKanban', name: 'Board' };

const idsOf = (entries) => entries.map((entry) => String(entry._id));

describe('project view entry ids', () => {
    test('the blank template ships no ids of its own, so the writer has to supply them', () => {
        expect(blankTemplate.TemplateRequiredComponent.every((entry) => entry._id === undefined)).toBe(true);
        expect(blankTemplate.TemplateRequiredComponent.map((entry) => entry.keyName)).toEqual(['ProjectListView', 'ProjectKanban']);
    });

    test('every entry of the blank template gets a view-length id on a catalogue with no Board row', () => {
        const entries = withViewIds(blankTemplate.TemplateRequiredComponent, [LIST_ROW, GANTT_ROW]);

        expect(entries.some(isMissingViewId)).toBe(false);
        entries.forEach((entry) => expect(String(entry._id)).toHaveLength(VIEW_ID_LENGTH));
        expect(entries.map((entry) => entry.keyName)).toEqual(['ProjectListView', 'ProjectKanban']);
    });

    test('a catalogued view takes the catalogue row id, matched on keyName not the renamable label', () => {
        const renamed = { ...BOARD_ROW, name: 'Kanban' };

        expect(withViewId({ keyName: 'ProjectKanban', name: 'Board' }, [renamed])._id).toBe(BOARD_ROW._id);
        expect(withViewId({ name: 'Board' }, [BOARD_ROW])._id).toBe(BOARD_ROW._id);
    });

    test('the id the catalogue cannot supply is a fresh ObjectId, distinct per entry', () => {
        const entries = withViewIds([{ keyName: 'ProjectKanban' }, { keyName: 'Comments' }], []);

        entries.forEach((entry) => expect(String(entry._id)).toMatch(/^[0-9a-f]{24}$/));
        expect(new Set(idsOf(entries)).size).toBe(2);
    });

    test('an entry that already has an id keeps it, so a later rename or delete still matches', () => {
        const embed = { name: 'Figma', _id: 'ab12cd', id: 'ab12cd' };
        const entries = withViewIds([{ ...LIST_ROW, viewStatus: true }, embed], [BOARD_ROW]);

        expect(idsOf(entries)).toEqual([LIST_ROW._id, 'ab12cd']);
    });

    test('repeating the repair changes nothing', () => {
        const once = withViewIds(blankTemplate.TemplateRequiredComponent, [LIST_ROW]);

        expect(withViewIds(once, [LIST_ROW])).toEqual(once);
    });

    test('the shapes a broken entry actually takes never throw', () => {
        for (const entries of [undefined, null, [null], [undefined], [{ _id: null }], [{ _id: '' }]]) {
            expect(() => withViewIds(entries, undefined)).not.toThrow();
        }
        expect(isMissingViewId({ _id: null })).toBe(true);
        expect(isMissingViewId({ _id: '' })).toBe(true);
        expect(isMissingViewId({ _id: LIST_ROW._id })).toBe(false);
    });
});

describe('createProject wiring', () => {
    test('the repair runs after every template branch, on the object that is saved', () => {
        const repair = SRC.indexOf('createProjectObject.ProjectRequiredComponent = withViewIds(');
        expect(repair).toBeGreaterThan(-1);
        // the branches that can leave an entry without an id
        expect(repair).toBeGreaterThan(SRC.indexOf('createProjectObject.ProjectRequiredComponent = res.TemplateRequiredComponent'));
        expect(repair).toBeGreaterThan(SRC.indexOf('createProjectObject.ProjectRequiredComponent = projectRequiredTempComponent'));
        expect(repair).toBeLessThan(SRC.indexOf('MongoDbCrudOpration(req.body.CompanyId, finalObj, "save")'));
    });
});
