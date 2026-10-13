/**
 * Export Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/ExportJobs/helpers/exportRules.js. Pure — no DB.
 */

const {
    validateExportInput,
    buildFileName,
    taskToRow,
    csvEscape,
    rowsToCsv,
    treeRows,
    taskRows,
} = require('../Modules/ExportJobs/helpers/exportRules');
const XLSX = require('xlsx');
const { transformCsvRows } = require('../Modules/Importers/helpers/csvRules');
const { levelRows } = require('../Modules/Tasks/helpers/taskTreeRules');

const COMPANY = '64b7f0c2a1b2c3d4e5f60700';
const PROJECT = '64b7f0c2a1b2c3d4e5f60711';

describe('📦 EXPORTS - Rules', () => {

    describe('validateExportInput', () => {

        const valid = { companyId: COMPANY, format: 'csv', projectId: PROJECT, userId: 'u1' };

        test('csv and xlsx pass; other formats fail', () => {
            expect(validateExportInput(valid).valid).toBe(true);
            expect(validateExportInput({ ...valid, format: 'xlsx' }).valid).toBe(true);
            expect(validateExportInput({ ...valid, format: 'pdf' }).valid).toBe(false);
        });

        test('missing companyId/userId/projectId fail', () => {
            expect(validateExportInput({ ...valid, companyId: '' }).valid).toBe(false);
            expect(validateExportInput({ ...valid, userId: '' }).valid).toBe(false);
            expect(validateExportInput({ ...valid, projectId: 'bad' }).valid).toBe(false);
        });

        test('sprintId optional but validated when present', () => {
            expect(validateExportInput({ ...valid, sprintId: '' }).valid).toBe(true);
            expect(validateExportInput({ ...valid, sprintId: PROJECT }).valid).toBe(true);
            expect(validateExportInput({ ...valid, sprintId: 'bad' }).valid).toBe(false);
        });
    });

    describe('buildFileName', () => {

        test('sanitises the project name and stamps it', () => {
            const name = buildFileName({ projectName: 'Web / Proto: Test!', format: 'csv', stamp: '2026-06-10' });
            expect(name).toBe('Web-Proto-Test-tasks-2026-06-10.csv');
        });

        test('falls back when the name sanitises to nothing', () => {
            expect(buildFileName({ projectName: '!!!', format: 'xlsx', stamp: 's' })).toBe('tasks-tasks-s.xlsx');
        });
    });

    describe('csv building', () => {

        test('escapes commas, quotes and newlines', () => {
            expect(csvEscape('plain')).toBe('plain');
            expect(csvEscape('a,b')).toBe('"a,b"');
            expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
            expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
            expect(csvEscape(null)).toBe('');
        });

        test('rowsToCsv emits a header and one line per row', () => {
            const csv = rowsToCsv([
                { A: '1', B: 'x,y' },
                { A: '2', B: 'plain' },
            ]);
            const lines = csv.split('\r\n');
            expect(lines[0]).toBe('A,B');
            expect(lines[1]).toBe('1,"x,y"');
            expect(lines[2]).toBe('2,plain');
        });

        test('empty input gives an empty string', () => {
            expect(rowsToCsv([])).toBe('');
        });
    });

    describe('taskToRow', () => {

        test('flattens the document with stable columns', () => {
            const row = taskToRow({
                TaskKey: 'AH-1',
                TaskName: 'Do it',
                status: { text: 'To Do' },
                statusType: 'open',
                Task_Priority: 'High',
                AssigneeUserId: ['u1', 'u2'],
                DueDate: '2026-06-15T00:00:00Z',
                totalEstimatedTime: 90,
                createdAt: '2026-06-01T10:00:00Z',
                updatedAt: '2026-06-02T10:00:00Z',
            });
            expect(row.TaskKey).toBe('AH-1');
            expect(row.Status).toBe('To Do');
            expect(row.Assignees).toBe('u1; u2');
            expect(row.DueDate).toBe('2026-06-15');
            expect(Object.keys(row)[0]).toBe('TaskKey');
        });

        test('null-safe on sparse documents', () => {
            const row = taskToRow({});
            expect(row.TaskName).toBe('');
            expect(row.Assignees).toBe('');
            expect(row.DueDate).toBe('');
        });
    });
});

describe('the subtask tree in a task export', () => {
    const task = (n, name, parent, ancestors) => ({
        _id: `id-${n}`, TaskKey: `WEB-${n}`, TaskName: name, status: { text: 'To Do' }, ParentTaskId: parent ? `id-${parent}` : '', ancestors: (ancestors || []).map((a) => `id-${a}`),
    });
    /* As a query returns them: in no order a reader could rely on. */
    const stored = () => [
        task(3, 'Grandchild', 2, [1, 2]),
        task(5, 'Second root'),
        task(2, 'Child', 1, [1]),
        task(7, 'Second grandchild', 2, [1, 2]),
        task(1, 'Root'),
        task(4, 'Second child', 1, [1]),
        task(6, 'Parent not exported', 99, [99]),
    ];
    const shape = (rows) => rows.map((row) => [row.TaskKey, row.Parent, row.Level]);

    test('a row carries its direct parent\'s key and its level', () => {
        const rows = taskRows(stored());
        expect(Object.keys(rows[0]).slice(0, 4)).toEqual(['TaskKey', 'TaskName', 'Parent', 'Level']);
        const byKey = Object.fromEntries(rows.map((row) => [row.TaskKey, row]));
        expect(byKey['WEB-1']).toMatchObject({ Parent: '', Level: 1 });
        expect(byKey['WEB-2']).toMatchObject({ Parent: 'WEB-1', Level: 2 });
        expect(byKey['WEB-3']).toMatchObject({ Parent: 'WEB-2', Level: 3 });
    });

    test('every level is exported in tree order: a parent, then its children', () => {
        expect(shape(taskRows(stored()))).toEqual([
            ['WEB-5', '', 1],
            ['WEB-1', '', 1],
            ['WEB-2', 'WEB-1', 2],
            ['WEB-3', 'WEB-2', 3],
            ['WEB-7', 'WEB-2', 3],
            ['WEB-4', 'WEB-1', 2],
            ['WEB-6', '', 1],
        ]);
    });

    test('a row whose parent is not in the export is a top-level row of the file', () => {
        const orphan = treeRows(stored()).find(({ task: row }) => row.TaskKey === 'WEB-6');
        expect(orphan).toMatchObject({ level: 1, parentKey: '' });
    });

    test('rows that name each other as parents are still exported, once each', () => {
        const looped = [task(1, 'One', 2), task(2, 'Two', 1), task(3, 'Three')];
        expect(taskRows(looped).map((row) => row.TaskKey).sort()).toEqual(['WEB-1', 'WEB-2', 'WEB-3']);
    });

    test('a sparse task is a level-one row', () => {
        expect(taskToRow({})).toMatchObject({ Parent: '', Level: 1 });
    });

    test('importing the exported file rebuilds the same parents and levels', () => {
        const csv = rowsToCsv(taskRows(stored()));
        const sheet = XLSX.read(csv, { type: 'string', raw: true });
        const parsed = XLSX.utils.sheet_to_json(sheet.Sheets[sheet.SheetNames[0]], { defval: '', raw: false });
        const shuffled = [parsed[3], parsed[6], parsed[0], parsed[5], parsed[2], parsed[1], parsed[4]];

        const { tasks, skipped } = transformCsvRows({ rows: shuffled, statusNames: ['To Do'], leaderId: 'u1' });
        const { levels, parentIdOf, adjusted } = levelRows(tasks);
        const nameOf = new Map(tasks.map((row) => [row._id, row.TaskName]));
        const rebuilt = Object.fromEntries(levels.flatMap((level, depth) => level.map((row) => [row.TaskName, { level: depth + 1, parent: nameOf.get(parentIdOf.get(row)) || '' }])));

        expect(skipped).toBe(0);
        expect(adjusted).toEqual([]);
        expect(rebuilt).toEqual({
            Root: { level: 1, parent: '' },
            'Second root': { level: 1, parent: '' },
            'Parent not exported': { level: 1, parent: '' },
            Child: { level: 2, parent: 'Root' },
            'Second child': { level: 2, parent: 'Root' },
            Grandchild: { level: 3, parent: 'Child' },
            'Second grandchild': { level: 3, parent: 'Child' },
        });
    });
});
