const rules = require('./automationRequests');
const catalogue = require('../Automations/engine/registry');

// The card of a waiting rule (frontend IntentPreview). The draft is turned into a rule for the person looking, from
// the statuses and people they may use, so it names nothing they cannot see; for someone who cannot open the
// project there is no card. A draft that is not a rule they could save shows why instead of a rule.

const TEXT_MAX = 250;
const SENTENCE_MAX = 600;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const paramsOf = (change) => (change && change.params && typeof change.params === 'object' ? change.params : {});
const capital = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
const card = (title, lines) => ({ kind: 'automation', title: title.slice(0, TEXT_MAX), lines: lines.filter(Boolean) });

const preview = async (change, { named, companyId, uid }) => {
    const params = paramsOf(change);
    const projectId = OBJECT_ID.test(String(params.projectId || '')) ? String(params.projectId) : '';
    const project = projectId ? named.project(projectId).name : null;
    if (!project) return null;
    const place = { kind: 'place', project, list: '' };
    const draft = rules.draftOf(params);
    const problem = rules.draftProblem(params);
    const built = problem ? { rule: null, rejected: [problem] } : await rules.ruleFor({ companyId, uid, draft });
    if (!built.rule) return card('', [place, { kind: 'ruleProblem', text: String(built.rejected[0] || '').slice(0, SENTENCE_MAX) }]);

    const { describeRule, actionSentence } = require('../Automations/helpers/sentenceRules');
    const sentence = describeRule(built.rule, { people: built.people }).slice(0, SENTENCE_MAX);
    const trigger = catalogue.getTrigger(built.rule.trigger.event);
    const runs = await rules.pastRuns({ companyId, uid, rule: built.rule });
    return card(sentence, [
        place,
        { kind: 'ruleStart', text: trigger ? trigger.label : '' },
        { kind: 'rule', text: sentence },
        ...built.rule.steps.map((step, at) => ({ kind: 'ruleStep', n: at + 1, text: capital(actionSentence(step, built.people)).slice(0, SENTENCE_MAX) })),
        { kind: 'ruleReach' },
        { kind: 'ruleState', on: draft.enabled },
        runs && { kind: 'ruleRuns', count: runs.count, days: runs.days },
        runs && runs.examples.length > 0 && { kind: 'ruleExamples', tasks: runs.examples },
    ]);
};

module.exports = { ACTION: rules.ACTION, preview };
