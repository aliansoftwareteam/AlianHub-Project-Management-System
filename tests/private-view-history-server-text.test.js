jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));

const { describePrivateViewChange } = require('../Modules/settings/Members/privateViewHistory');

const PROJECT = '6f0000000000000000000701';
const A = 'Max Member';
const HTML = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert&#40;1&#41;&gt;';

const board = { id: 'v1', name: 'Board', keyName: 'ProjectKanban', isPin: true, projectId: PROJECT };
const sheet = { id: 'v2', name: 'Sheet', url: 'https://example.com', isPin: false, projectId: PROJECT };
const member = { ProjectRequiredComponent: [board, sheet] };

const describe_ = (operation, data, key) => describePrivateViewChange({ A, operation, key, data, previous: member });

describe('private view history text', () => {
    it('names a view added with its pin', () => {
        expect(describe_('push', { ...board, id: 'v3' })).toEqual({
            projectId: PROJECT,
            entry: { key: 'Project_Name', message: `<b>${A}</b> has added the <b> pinned private View </b> as <b>Board</b>` },
        });
    });

    it('names an embed view added and escapes its name', () => {
        expect(describe_('push', { ...sheet, id: 'v4', name: HTML }).entry.message)
            .toBe(`<b>${A}</b> has added the <b>  private Embed View </b> as <b>${ESCAPED}</b>`);
    });

    it('describes a rename from the stored name', () => {
        expect(describe_('update', { id: 'v2', name: 'Budget' }, 'name')).toEqual({
            projectId: PROJECT,
            entry: { key: 'Project_Name', message: `<b>${A}</b> has changed the  <b> Embed View name </b> as <b> Budget </b>  from <b>Sheet </b>` },
        });
    });

    it('describes a removal from the stored view', () => {
        expect(describe_('delete', { id: 'v2' }).entry.message).toBe(`<b> ${A} </b> has deleted the  <b> Embed View Sheet </b>`);
        expect(describe_('delete', { id: 'v1' }).entry.message).toBe(`<b> ${A} </b> has Deleted the <b> Board View </b>`);
    });

    it.each([
        ['a rename that keeps the name', 'update', { id: 'v2', name: 'Sheet' }, 'name'],
        ['a rename of a view the member does not have', 'update', { id: 'nope', name: 'X' }, 'name'],
        ['a removal of a view the member does not have', 'delete', { id: 'nope' }, undefined],
        ['a view added without a project', 'push', { id: 'v5', name: 'Loose' }, undefined],
    ])('writes nothing for %s', (what, operation, data, key) => {
        expect(describe_(operation, data, key)).toBeNull();
    });
});
