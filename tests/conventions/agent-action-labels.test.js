/* Every change an agent can make has plain words in en.js (AgentActions), so the notice, the approval cards and
   the audit log never fall back to the registry's own English label for one. */
const path = require('path');
const { SRC, loadLocale } = require('./locale-keys');
const { wordsIn } = require('../../scripts/plain-words');
const registry = require('../../Modules/Agents/registry');
const groups = require('../../Modules/Agents/registryGroups');

const NAMESPACE = 'AgentActions';
const LABEL_MAX = 40;

/* The same slug frontend/src/views/Ai/plainLabels.js makes of a key (labelSlug). */
const slugOf = (key) => String(key).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const actions = [...registry.ACTIONS, ...groups.flatMap((group) => group.entries.map((entry) => entry.action))];
const writes = actions.filter((action) => action.write);
const labels = loadLocale(path.join(SRC, 'locales', 'en.js'))[NAMESPACE] || {};

describe('plain words for what an agent did', () => {
    it('reads the registry (flagged groups included)', () => {
        expect(writes.length).toBeGreaterThan(40);
        expect(writes.map((action) => action.key)).toEqual(expect.arrayContaining(['task.comment', 'tasks.batch', 'project.create', 'view.create']));
    });

    it('gives every action that writes a label of its own', () => {
        const missing = writes.filter((action) => typeof labels[slugOf(action.key)] !== 'string' || !labels[slugOf(action.key)].trim()).map((action) => `${action.key} -> ${NAMESPACE}.${slugOf(action.key)}`);
        expect(missing).toEqual([]);
    });

    it('never lets two actions share one key', () => {
        const slugs = actions.map((action) => slugOf(action.key));
        expect(slugs.filter((slug, at) => slugs.indexOf(slug) !== at)).toEqual([]);
    });

    it('holds no label for an action the registry does not have', () => {
        const known = new Set(actions.map((action) => slugOf(action.key)));
        expect(Object.keys(labels).filter((slug) => !known.has(slug))).toEqual([]);
    });

    it('keeps each label short, and free of the registry\'s own notes and of listed words', () => {
        const wrong = Object.entries(labels).filter(([slug, label]) => label.length > LABEL_MAX || /[()/]/.test(label) || wordsIn(`${NAMESPACE}.${slug}`, label).length).map(([slug, label]) => `${slug}: ${label}`);
        expect(wrong).toEqual([]);
    });
});
