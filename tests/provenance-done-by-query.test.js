/* Task 010 (29b): the "Done by" filter narrows List, Table and Board through the shared task
   search, so its condition runs in Mongo. It must pick exactly the tasks whose row badge reads
   the chosen pattern: a closed task with a closedBy record, classified from workBy and
   checkedBy. sift is Mongoose's own query matcher. */
const sift = require('sift');
const C = require('../Modules/Tasks/helpers/completion');
const { validatePipeline } = require('../Modules/Tasks/helpers/taskQueryGuard');
const { ALL, DONE_BY_OPTIONS, cleanDoneBy, doneByMatch } = require('../frontend/src/components/molecules/Provenance/doneByQuery');

const at = new Date('2026-09-01T10:00:00Z');
const person = (id) => ({ actorId: id, actorType: 'human', at });
const human = (id, hours = 1) => ({ actorId: id, actorType: 'human', viaAccount: 'workspace', hours });
const agent = (id, hours = 1) => ({ actorId: id, actorType: 'agent', agentId: `a-${id}`, viaAccount: 'workspace', hours });

const task = (_id, statusType, completion) => ({ _id, statusType, ...(completion === undefined ? {} : { completion }) });

const TASKS = [
    task('human-closed', 'close', { workBy: [human('u1')], checkedBy: null, closedBy: person('u1') }),
    task('human-no-work', 'close', { workBy: [], checkedBy: null, closedBy: person('u1') }),
    task('agent-checked', 'close', { workBy: [agent('u2')], checkedBy: person('u3'), closedBy: person('u3') }),
    task('mixed-checked', 'close', { workBy: [human('u1'), agent('u2')], checkedBy: person('u3'), closedBy: person('u3') }),
    task('agent-unchecked', 'close', { workBy: [agent('u2')], checkedBy: null, closedBy: person('u1') }),
    task('mixed-unchecked', 'close', { workBy: [human('u1'), agent('u2')], closedBy: person('u1') }),
    task('open-agent', 'active', { workBy: [agent('u2')], checkedBy: person('u3'), closedBy: null }),
    task('open-plain', 'active'),
    task('closed-no-record', 'close'),
    task('closed-before-provenance', 'close', { workBy: [agent('u2')], checkedBy: person('u3'), closedBy: null }),
];

/* The badge a row shows: nothing until the task is closed with a closedBy record. */
const rowBadge = (t) => (t.statusType === 'close' && t.completion && t.completion.closedBy ? C.deriveBadge(t.completion) : null);

describe('the Done by options', () => {
    test('offer all and the four patterns', () => {
        expect(DONE_BY_OPTIONS).toEqual([ALL, 'human', 'agent', 'mixed', 'unchecked']);
    });

    test('an unknown or missing value reads as all, which adds no condition', () => {
        expect(cleanDoneBy('AGENT')).toBe('agent');
        expect(cleanDoneBy('robots')).toBe(ALL);
        expect(cleanDoneBy(undefined)).toBe(ALL);
        expect(doneByMatch(ALL)).toBeNull();
        expect(doneByMatch('nonsense')).toBeNull();
    });
});

describe.each(['human', 'agent', 'mixed', 'unchecked'])('Done by %s', (option) => {
    const expected = TASKS.filter((t) => rowBadge(t) === option.toUpperCase()).map((t) => t._id);

    test('matches exactly the tasks whose row badge reads that pattern', () => {
        const matched = TASKS.filter(sift(doneByMatch(option))).map((t) => t._id);
        expect(expected.length).toBeGreaterThan(0);
        expect(matched).toEqual(expected);
    });

    test('passes the task query guard inside the search pipeline', () => {
        const pipeline = [{ $match: { $and: [{ deletedStatusKey: { $in: [0] } }, doneByMatch(option)] } }];
        expect(() => validatePipeline(pipeline)).not.toThrow();
    });
});
