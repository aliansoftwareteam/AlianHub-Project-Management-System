/* Every key the server writes to the audit log has plain words: in Modules/Audit/eventWords.js for the export,
   and the same words in en.js (AuditEvents, AuditActions, AgentActions) for the screen. A key written with none
   shows raw in the Event column, so a new one fails here first. */
const fs = require('fs');
const path = require('path');
const { SRC, loadLocale } = require('./locale-keys');
const { wordsIn } = require('../../scripts/plain-words');
const registry = require('../../Modules/Agents/registry');
const groups = require('../../Modules/Agents/registryGroups');
const { PTO_STATUS } = require('../../Modules/Pto/helpers/ptoRules');
const routeWrites = require('../../Modules/Agents/routeWrites');

const ROOT = path.join(__dirname, '..', '..');
const SERVER_DIRS = ['Modules', 'Config', 'utils', 'middlewares', 'socket', 'event'];
const LABEL_MAX = 60;

const slugOf = (key) => String(key).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const KEY = String.raw`[a-z][a-z0-9_]*(?:\.(?:[a-z0-9_*]+|\$\{[^}]+\}))+`;
const QUOTED = new RegExp(String.raw`(['"\`])(${KEY})\1`, 'g');
/* A file that writes a row: every dotted key it quotes is read. */
const ROW_WRITER = /\b(recordAudit|recordAuditFromReq|recordAutomationAudit|saveAuditRow|recordRefusal|recordLoopRefusal|auditRefusal|auditTransition)\(|\bagentAudit\b|\baudit\.(record[A-Z]\w*|openAction)\(|idempotency\.once\(|\.\.\.context, action:|\.\.\.forTool\(context\)/;
/* A route that names what only a person may do: an agent's attempt is recorded under that name. */
const PERSON_ONLY = new RegExp(String.raw`\b(?:decidedByPerson|setByPerson|agentsRefused|agentsReadAlone)\(\s*(['"\`])(${KEY})\1|\bpersonDecides\([^,()]+,[^,()]+,\s*(['"\`])(${KEY})\3|\bconst [A-Z_]*ACTION[A-Z_]* = (['"\`])(${KEY})\5`, 'g');

const walk = (dir, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules') walk(full, out);
        } else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
};

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const serverFiles = SERVER_DIRS.flatMap((dir) => walk(path.join(ROOT, dir))).map((file) => path.relative(ROOT, file));

const scan = () => {
    const found = new Map();
    const add = (key, file) => found.set(key, [...(found.get(key) || []), file]);
    serverFiles.forEach((file) => {
        const text = read(file);
        if (ROW_WRITER.test(text)) [...text.matchAll(QUOTED)].forEach((m) => add(m[2], file));
        [...text.matchAll(PERSON_ONLY)].forEach((m) => add(m[2] || m[4] || m[6], file));
    });
    return found;
};

/* Dotted strings in those files that are not keys of the log. */
const NOT_KEYS = {
    'meta.state': 'a field of the row', 'meta.undo': 'a field of the row', 'meta.undoable': 'a field of the row', 'meta.failed': 'a field of the row',
    'meta.action': 'a field of the row', 'meta.reason': 'a field of the row', 'meta.amends': 'a field of the row', 'chain.seq': 'a field of the row',
    'facts.role': 'a field of a queue row', 'spend.usd': 'a field of a run', 'spend.tokens': 'a field of a run', 'episode.reverted': 'a field of a run', 'elem.id': 'an array filter',
    'targets.${index}.sources': 'a field of a goal', 'opts.resolve': 'an argument name',
    'conversations.list': 'a Slack method', 'conversations.info': 'a Slack method', 'conversations.history': 'a Slack method', 'auth.test': 'a Slack method',
    'slack.channel': 'the name of a reader', 'home.arpa': 'a host name', 'github.com': 'a host name', 'gitlab.com': 'a host name',
    'index.js': 'a file name', 'export.truncated': 'the note that ends a cut export',
    'task.notify': 'a scope of an automation step', 'task.read': 'a scope of an automation step', 'task.subtask.create': 'a scope of an automation step',
    'proposals.approve': 'a function named in a comment',
    'workflow.run.id': 'a trace attribute', 'workflow.step.id': 'a trace attribute', 'workflow.step.type': 'a trace attribute', 'tenant.id': 'a trace attribute',
    'agent.${action}': 'the context of a change perform() already recorded, which writes no row of its own',
};

const registered = (file) => [...read(file).matchAll(/executors\.register\((\w+),/g)].map((m) => (new RegExp(`const ${m[1]} = '([a-z_]+)'`).exec(read(file)) || [])[1]);
const stepTypes = serverFiles.filter((file) => file.startsWith(path.join('Modules', 'Workflows'))).flatMap(registered);
const automationSteps = serverFiles.filter((file) => file.startsWith(path.join('Modules', 'Automations', 'engine', 'actions'))).map((file) => (/key: '([a-z_]+)'/.exec(read(file)) || [])[1]).filter(Boolean);

/* A key built at the moment it is written, and every key it can come to. */
const TEMPLATES = {
    'billing.invoice.${target}': ['sent', 'paid'].map((target) => `billing.invoice.${target}`),
    'pto.${status}': PTO_STATUS.map((status) => `pto.${status}`),
    'agent_session.${state}': ['completed', 'failed', 'revoked', 'unresponsive'].map((state) => `agent_session.${state}`),
    'workflow.${claimed.type}': stepTypes.map((type) => `workflow.${type}`),
    'workflow.${tool.key}': automationSteps.map((key) => `workflow.${key}`),
    'workflow.loop.${REASON}': ['workflow.loop.run_limit'],
    'assignment.suggestion.${action}': ['accept', 'dismiss', 'undo'].map((action) => `assignment.suggestion.${action}`),
    "tasks.${name || 'unknown'}": ['tasks.unknown'],
    "goal.${WORD.test(last) ? last : 'write'}": ['goal.write'],
};

const actions = [...registry.ACTIONS, ...groups.flatMap((group) => group.entries.map((entry) => entry.action))];
const registryKeys = new Set(actions.map((action) => action.key));
const words = require('../../Modules/Audit/eventWords');
const worded = (key) => registryKeys.has(key) || key in words.EVENTS || key in words.ACTIONS;
const en = loadLocale(path.join(SRC, 'locales', 'en.js'));
const found = scan();

describe('the keys the server writes to the audit log', () => {
    it('are read from every file that writes a row or names what only a person may do', () => {
        expect(found.size).toBeGreaterThan(150);
        ['agent.project_policy_changed', 'automation.task.comment', 'member.update', 'model.call', 'sprint.start', 'timesheet.review', 'workflow.${claimed.type}'].forEach((key) => expect([...found.keys()]).toContain(key));
        expect(stepTypes).toEqual(expect.arrayContaining(['agent_run', 'automation_rule', 'human_approval', 'fan_out', 'timer']));
        expect(automationSteps).toEqual(expect.arrayContaining(['add_comment', 'set_status', 'run_agent']));
    });

    it('each have words, or are listed here as something else', () => {
        const unworded = [...found.keys()].filter((key) => !worded(key) && !(key in NOT_KEYS) && !(key in TEMPLATES)).map((key) => `${key} (${found.get(key)[0]})`);
        expect(unworded).toEqual([]);
    });

    it('have words for every key a built one can come to', () => {
        const unworded = Object.entries(TEMPLATES).flatMap(([template, keys]) => keys.filter((key) => !worded(key)).map((key) => `${key} (from ${template})`));
        expect(unworded).toEqual([]);
        expect(Object.values(TEMPLATES).filter((keys) => !keys.length)).toEqual([]);
    });

    it('have words for every name a route records an agent\'s write under', () => {
        expect(routeWrites.ROUTE_ONLY.filter((key) => !(key in words.ACTIONS))).toEqual([]);
        expect(routeWrites.ALSO_A_TOOL.filter((key) => !registryKeys.has(key))).toEqual([]);
    });

    it('leave nothing listed here that the server no longer holds', () => {
        expect([...Object.keys(NOT_KEYS), ...Object.keys(TEMPLATES)].filter((key) => !found.has(key))).toEqual([]);
    });
});

describe('the words on screen', () => {
    const sameWords = (labels, namespace) => Object.entries(labels).filter(([key, label]) => (en[namespace] || {})[slugOf(key)] !== label).map(([key]) => `${namespace}.${slugOf(key)} for ${key}`);

    it('are the server\'s words for what happened', () => {
        expect(Object.keys(words.EVENTS).length).toBeGreaterThan(80);
        expect(sameWords(words.EVENTS, 'AuditEvents')).toEqual([]);
    });

    it('are the server\'s words for what an agent did or tried outside its registry', () => {
        expect(Object.keys(words.ACTIONS).length).toBeGreaterThan(100);
        expect(sameWords(words.ACTIONS, 'AuditActions')).toEqual([]);
    });

    it('hold no key the server does not have', () => {
        const slugs = (labels) => new Set(Object.keys(labels).map(slugOf));
        expect(Object.keys(en.AuditEvents || {}).filter((slug) => !slugs(words.EVENTS).has(slug))).toEqual([]);
        expect(Object.keys(en.AuditActions || {}).filter((slug) => !slugs(words.ACTIONS).has(slug))).toEqual([]);
    });

    it('never give two keys one slug', () => {
        [words.EVENTS, words.ACTIONS].forEach((labels) => {
            const slugs = Object.keys(labels).map(slugOf);
            expect(slugs.filter((slug, at) => slugs.indexOf(slug) !== at)).toEqual([]);
        });
        expect(Object.keys(words.ACTIONS).filter((key) => registryKeys.has(key))).toEqual([]);
    });

    it('cover every action of the agent registry, the ones that only read too', () => {
        const labels = en.AgentActions || {};
        expect(actions.filter((action) => typeof labels[slugOf(action.key)] !== 'string' || !labels[slugOf(action.key)].trim()).map((action) => action.key)).toEqual([]);
    });

    it('are short and use no listed word', () => {
        const wrong = ['AuditEvents', 'AuditActions'].flatMap((namespace) => Object.entries(en[namespace] || {})
            .filter(([slug, label]) => label.length > LABEL_MAX || wordsIn(`${namespace}.${slug}`, label).length)
            .map(([slug, label]) => `${namespace}.${slug}: ${label}`));
        expect(wrong).toEqual([]);
    });
});
