const readRows = require('./fixtures/importers/clickupRichRows');
const { transformClickUpRows } = require('../Modules/Importers/helpers/clickupRules');
const { parseComments, parseChecklists, parseAttachmentLinks } = require('../Modules/Importers/helpers/clickupDetails');
const { FIELD_TYPES, fieldTypeOf, planFields } = require('../Modules/Importers/helpers/clickupFields');
const { planClickUpList, mergeSummaries } = require('../Modules/Importers/helpers/clickupPlan');

const PROJECT = '6f0000000000000000000d81';
const MAX = '6f00000000000000000000a1';
const LEE = '6f00000000000000000000a2';

const rows = readRows();
const cell = (id, column) => rows.find((row) => row['Task ID'] === id)[column];
const transform = () => transformClickUpRows({ rows: readRows(), statusFor: (name) => name, leaderId: 'leader-1' });
const taskNamed = (tasks, name) => tasks.find((task) => task.TaskName === name);

describe('the comments column', () => {
    it('reads each comment with its author and time, oldest first when every one is dated', () => {
        expect(parseComments(cell('c1', 'Comments'))).toEqual([
            { text: 'Kick-off is on Monday', author: 'max@member.test', email: 'max@member.test', at: '2026-01-05T09:00:00.000Z' },
            { text: 'Room is booked', author: 'Pat Example', email: '', at: '2026-01-06T10:30:00.000Z' },
        ]);
    });

    it('reads an author given as a person, and a time in milliseconds', () => {
        expect(parseComments(cell('c2', 'Comments'))).toEqual([
            { text: 'Draft is in the doc', author: 'Max Member', email: 'max@member.test', at: '2026-01-06T12:00:00.000Z' },
        ]);
    });

    it('keeps the file order when a comment has no date, and a comment may have no author', () => {
        expect(parseComments(cell('c3', 'Comments'))).toEqual([
            { text: 'Two typos fixed', author: 'ghost@nowhere.test', email: 'ghost@nowhere.test', at: null },
            { text: 'Ready to send', author: '', email: '', at: null },
        ]);
    });

    it('reads a cell that is plain text as one comment, and nothing from an empty cell', () => {
        expect(parseComments('Looks good')).toEqual([{ text: 'Looks good', author: '', email: '', at: null }]);
        expect(parseComments('')).toEqual([]);
        expect(parseComments('[]')).toEqual([]);
    });

    it('never carries a file: only the text, the author and the time', () => {
        const withFile = JSON.stringify([{ text: 'see the file', by: 'Pat', mediaURL: 'Project/x/y/z/Comments/secret.png', attachment: { url: 'k' }, type: 'image' }]);
        expect(parseComments(withFile)).toEqual([{ text: 'see the file', author: 'Pat', email: '', at: null }]);
    });
});

describe('the checklists column', () => {
    it('reads a checklist named with its items', () => {
        expect(parseChecklists(cell('c1', 'Checklists'))).toEqual([
            { name: 'Before launch', items: [{ name: 'Book the room', isChecked: false }, { name: 'Send invites', isChecked: false }] },
        ]);
    });

    it('keeps the done state when the file carries it', () => {
        expect(parseChecklists(cell('c2', 'Checklists'))).toEqual([
            { name: 'Copy', items: [{ name: 'Draft', isChecked: true }, { name: 'Review', isChecked: false }] },
        ]);
    });

    it('reads a bare list of items as one checklist', () => {
        expect(parseChecklists('[Pack, Ship]')).toEqual([{ name: 'Checklist', items: [{ name: 'Pack', isChecked: false }, { name: 'Ship', isChecked: false }] }]);
        expect(parseChecklists('')).toEqual([]);
    });
});

describe('the attachments column', () => {
    it('becomes links named after the file, and only http links', () => {
        expect(parseAttachmentLinks(cell('c1', 'Attachments'))).toEqual([
            { url: 'https://files.clickup.test/t1/brief.pdf', label: 'brief.pdf' },
            { url: 'https://files.clickup.test/t1/shot.png', label: 'shot.png' },
        ]);
        expect(parseAttachmentLinks('')).toEqual([]);
    });
});

describe('ClickUp rows carry their details', () => {
    it('hands each task its comments, checklists, links and field cells', () => {
        const { tasks } = transform();
        const plan = taskNamed(tasks, 'Plan the launch');
        expect(plan.comments).toHaveLength(2);
        expect(plan.checklists).toHaveLength(1);
        expect(plan.links.map((link) => link.label)).toEqual(['brief.pdf', 'shot.png']);
        expect(plan.attachments).toBeUndefined();
        expect(plan.fieldCells['Budget (currency)']).toBe('$1,200.50');
        expect(taskNamed(tasks, 'Proofread').fieldCells).toEqual({ 'Stage (drop down)': 'Discovery', 'Score (rating)': '7' });
    });

    it('lists every field column with the type it maps to', () => {
        expect(transform().fields.map(({ name, clickUpType, type, asText }) => [name, clickUpType, type, asText])).toEqual([
            ['Budget', 'currency', 'money', false],
            ['Stage', 'drop_down', 'dropdown', false],
            ['Areas', 'labels', 'dropdown', false],
            ['Approved', 'checkbox', 'checkbox', false],
            ['Contact', 'email', 'email', false],
            ['Phone', 'phone', 'phone', false],
            ['Spec', 'url', 'url', false],
            ['Reviewers', 'users', 'people', false],
            ['Score', 'rating', 'rating', false],
            ['Done so far', 'manual_progress', 'progress', false],
            ['Site', 'location', 'text', true],
            ['Story Points', 'number', 'number', false],
            ['Launch Date', 'date', 'date', false],
            ['Client', 'short_text', 'text', false],
            ['Notes', 'text', 'textarea', false],
            ['Unused', 'number', 'number', false],
        ]);
    });
});

describe('the field type table', () => {
    it('maps each ClickUp type to one field type, and anything else to text', () => {
        expect(FIELD_TYPES).toEqual({
            short_text: 'text', text: 'textarea', long_text: 'textarea', number: 'number', currency: 'money', money: 'money',
            date: 'date', drop_down: 'dropdown', dropdown: 'dropdown', labels: 'dropdown', checkbox: 'checkbox', email: 'email',
            phone: 'phone', url: 'url', website: 'url', users: 'people', people: 'people', rating: 'rating', emoji: 'rating',
            manual_progress: 'progress', progress: 'progress',
        });
        expect(fieldTypeOf('Drop Down')).toEqual({ clickUpType: 'drop_down', type: 'dropdown', asText: false });
        expect(fieldTypeOf('formula')).toEqual({ clickUpType: 'formula', type: 'text', asText: true });
        expect(fieldTypeOf('automatic progress')).toEqual({ clickUpType: 'automatic_progress', type: 'text', asText: true });
    });
});

describe('field columns become definitions and values', () => {
    const plan = (over = {}) => {
        const { tasks, fields } = transform();
        const out = planFields({ columns: fields, tasks, definitions: [], projectId: PROJECT, idByEmail: new Map([['max@member.test', MAX]]), ...over });
        const column = (name) => out.columns.find((entry) => entry.name === name);
        const value = (taskName, name) => {
            const held = (out.values.get(taskNamed(tasks, taskName)) || []).find((entry) => entry.column.name === name);
            return held ? held.detail.fieldValue : undefined;
        };
        const labels = (taskName, name) => (value(taskName, name) || []).map((id) => column(name).definition.fieldOptions.find((option) => option.id === id).label);
        return { ...out, column, value, labels };
    };

    it('creates a definition for every column that holds a value, and leaves an empty column alone', () => {
        const { columns } = plan();
        expect(columns.filter((entry) => entry.action === 'create').map((entry) => [entry.name, entry.definition.fieldType])).toEqual([
            ['Budget', 'money'], ['Stage', 'dropdown'], ['Areas', 'dropdown'], ['Approved', 'checkbox'], ['Contact', 'email'], ['Phone', 'phone'],
            ['Spec', 'url'], ['Reviewers', 'people'], ['Score', 'rating'], ['Done so far', 'progress'], ['Site', 'text'], ['Story Points', 'number'],
            ['Launch Date', 'date'], ['Client', 'text'], ['Notes', 'textarea'],
        ]);
        expect(columns.find((entry) => entry.name === 'Unused').action).toBe('empty');
    });

    it('sets each value in the form its field stores', () => {
        const { value, labels } = plan();
        expect(value('Plan the launch', 'Budget')).toBe('1200.5');
        expect(labels('Plan the launch', 'Stage')).toEqual(['Discovery']);
        expect(labels('Plan the launch', 'Areas')).toEqual(['Web', 'Mobile']);
        expect(value('Plan the launch', 'Approved')).toBe(true);
        expect(value('Plan the launch', 'Contact')).toBe('pat@client.test');
        expect(value('Plan the launch', 'Phone')).toBe('+1 201 555 0123');
        expect(value('Plan the launch', 'Spec')).toBe('https://example.test/spec');
        expect(value('Plan the launch', 'Reviewers')).toEqual([MAX]);
        expect(value('Plan the launch', 'Score')).toBe(4);
        expect(value('Plan the launch', 'Done so far')).toBe(60);
        expect(value('Plan the launch', 'Site')).toBe('12 High Street');
        expect(value('Plan the launch', 'Story Points')).toBe('5');
        expect(value('Plan the launch', 'Launch Date')).toBe('2026-02-01T00:00:00.000Z');
        expect(value('Plan the launch', 'Notes')).toBe('Long notes about the launch');
        expect(labels('Archive the notes', 'Stage')).toEqual(['Closed']);
    });

    it('leaves out a value that does not fit and counts it', () => {
        const { column, value } = plan();
        ['Budget', 'Approved', 'Contact', 'Spec', 'Score', 'Done so far'].forEach((name) => expect(value('Write the invite', name)).toBeUndefined());
        expect(value('Write the invite', 'Story Points')).toBe('3');
        expect(['Budget', 'Approved', 'Contact', 'Spec', 'Reviewers', 'Score', 'Done so far'].map((name) => column(name).dropped)).toEqual([1, 1, 1, 1, 1, 1, 1]);
        expect(column('Stage')).toMatchObject({ set: 4, dropped: 0 });
        expect(column('Score')).toMatchObject({ set: 2, dropped: 1 });
        expect(column('Score').definition.fieldRatingMax).toBe(7);
    });

    it('reports the people a people field names who are not members', () => {
        expect(plan().unmatchedPeople).toEqual(['ghost@nowhere.test']);
    });

    it('reuses a field of the same name and a compatible type, and creates beside one that is not', () => {
        const definitions = [
            { _id: 'f-stage', fieldTitle: 'stage', fieldType: 'dropdown', type: 'task', global: false, projectId: [PROJECT], fieldOptions: [{ id: 'o1', label: 'Discovery', value: 'discovery' }] },
            { _id: 'f-budget', fieldTitle: 'Budget', fieldType: 'text', type: 'task', global: false, projectId: [PROJECT] },
            { _id: 'f-score', fieldTitle: 'Score', fieldType: 'rating', fieldRatingMax: 5, type: 'task', global: true },
            { _id: 'f-areas', fieldTitle: 'Areas', fieldType: 'dropdown', type: 'task', global: true, fieldOptions: [{ id: 'w', label: 'Web', value: 'web' }] },
            { _id: 'f-client', fieldTitle: 'Client', fieldType: 'text', type: 'task', global: false, projectId: ['6f0000000000000000000d99'] },
            { _id: 'f-notes', fieldTitle: 'Notes', fieldType: 'text', type: 'task', global: false, projectId: [PROJECT] },
        ];
        const { column, value } = plan({ definitions });

        expect(column('Stage')).toMatchObject({ action: 'reuse', addedOptions: ['Delivery', 'Closed'], set: 4, dropped: 0 });
        expect(column('Stage').definition._id).toBe('f-stage');
        expect(value('Plan the launch', 'Stage')).toEqual(['o1']);

        expect(column('Budget').action).toBe('create');
        expect(column('Notes')).toMatchObject({ action: 'reuse' });
        expect(column('Client').action).toBe('create');

        expect(column('Score')).toMatchObject({ action: 'reuse', set: 1, dropped: 2 });
        expect(column('Areas')).toMatchObject({ action: 'reuse', addedOptions: [], set: 2, dropped: 1 });
        expect(value('Plan the launch', 'Areas')).toEqual(['w']);
    });

    it('skips every column, with the reason, when the person may not edit fields', () => {
        const { columns, values } = plan({ allowed: false });
        expect(columns.filter((entry) => entry.action === 'skipped')).toHaveLength(15);
        expect(columns.find((entry) => entry.name === 'Budget')).toMatchObject({ action: 'skipped', reason: 'no_permission', set: 0, dropped: 0 });
        expect([...values.values()].flat()).toEqual([]);
    });
});

describe('what an import of one list will bring in', () => {
    const planned = (over = {}) => {
        const { tasks, fields, unnamedAssignees } = transform();
        return {
            tasks,
            ...planClickUpList({
                tasks,
                columns: fields,
                unnamedAssignees,
                state: { projectId: PROJECT, definitions: [], tags: ['Launch'] },
                people: { memberIdByEmail: new Map([['max@member.test', MAX], ['lee@private.test', LEE]]), openIdByEmail: new Map([['max@member.test', MAX]]) },
                allowed: { fields: true, comments: true, tags: true },
                ...over,
            }),
        };
    };

    it('counts every kind, with what is left out and why', () => {
        expect(planned().summary).toEqual({
            tasks: 2,
            subtasks: { level2: 1, level3: 1 },
            comments: { imported: 5, skipped: 0, reason: '', unmatchedAuthors: ['Pat Example', 'ghost@nowhere.test'] },
            fields: {
                created: ['Budget', 'Stage', 'Areas', 'Approved', 'Contact', 'Phone', 'Spec', 'Reviewers', 'Score', 'Done so far', 'Site', 'Story Points', 'Launch Date', 'Client', 'Notes'],
                reused: [],
                asText: ['Site'],
                skipped: [],
                reason: '',
                valuesSet: 22,
                valuesDropped: 7,
            },
            checklistItems: 4,
            tags: { added: ['urgent', 'archive'], skipped: [] },
            links: 3,
            people: { unmatched: ['ghost@nowhere.test', 'Pat Example'], cannotOpen: ['lee@private.test'] },
        });
    });

    it('assigns only members who can open the project', () => {
        const { tasks, assignees } = planned();
        expect(assignees.get(taskNamed(tasks, 'Plan the launch'))).toEqual([MAX]);
        expect(assignees.get(taskNamed(tasks, 'Proofread'))).toEqual([]);
    });

    it('leaves out comments, fields and new tags the person may not add, and says so', () => {
        const { summary } = planned({ allowed: { fields: false, comments: false, tags: false } });
        expect(summary.comments).toEqual({ imported: 0, skipped: 5, reason: 'no_permission', unmatchedAuthors: [] });
        expect(summary.fields).toMatchObject({ created: [], skipped: expect.arrayContaining(['Budget', 'Stage']), reason: 'no_permission', valuesSet: 0, valuesDropped: 0 });
        expect(summary.fields.skipped).toHaveLength(15);
        expect(summary.tags).toEqual({ added: [], skipped: ['urgent', 'archive'] });
        expect(summary).toMatchObject({ tasks: 2, checklistItems: 4, links: 3 });
    });
});

describe('the summaries of several lists as one', () => {
    it('adds the counts and names each thing once; a field one list created is not reused by the next', () => {
        const one = {
            tasks: 2, subtasks: { level2: 1, level3: 0 }, checklistItems: 2, links: 1,
            comments: { imported: 3, skipped: 0, reason: '', unmatchedAuthors: ['Pat Example'] },
            fields: { created: ['Stage'], reused: ['Client'], asText: [], skipped: [], reason: '', valuesSet: 4, valuesDropped: 1 },
            tags: { added: ['urgent'], skipped: [] },
            people: { unmatched: ['ghost@nowhere.test'], cannotOpen: [] },
        };
        const two = {
            tasks: 1, subtasks: { level2: 0, level3: 2 }, checklistItems: 1, links: 0,
            comments: { imported: 0, skipped: 2, reason: 'no_permission', unmatchedAuthors: ['Pat Example', 'Sam'] },
            fields: { created: ['Budget'], reused: ['Stage', 'Client'], asText: ['Site'], skipped: ['Notes'], reason: 'no_permission', valuesSet: 2, valuesDropped: 0 },
            tags: { added: [], skipped: ['later'] },
            people: { unmatched: ['ghost@nowhere.test'], cannotOpen: ['lee@private.test'] },
        };
        expect(mergeSummaries([one, two])).toEqual({
            tasks: 3, subtasks: { level2: 1, level3: 2 }, checklistItems: 3, links: 1,
            comments: { imported: 3, skipped: 2, reason: 'no_permission', unmatchedAuthors: ['Pat Example', 'Sam'] },
            fields: { created: ['Stage', 'Budget'], reused: ['Client'], asText: ['Site'], skipped: ['Notes'], reason: 'no_permission', valuesSet: 6, valuesDropped: 1 },
            tags: { added: ['urgent'], skipped: ['later'] },
            people: { unmatched: ['ghost@nowhere.test'], cannotOpen: ['lee@private.test'] },
        });
        expect(mergeSummaries([])).toMatchObject({ tasks: 0, links: 0, fields: { created: [], valuesSet: 0 } });
    });
});
