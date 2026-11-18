// "Describe your new teammate": one model call drafts the wizard's three steps.
// The draft is only ever a suggestion for the wizard to show; nothing here
// writes an agent. Whatever the model answers is narrowed to what exists and
// what a new agent may start with, so a description cannot talk its way into
// an action, a project or an autonomy level the wizard would not offer.

const registry = require('./registry');
const skillRecord = require('./skillRecord');
const scope = require('./scope');
const budget = require('./budget');
const aiSwitch = require('../AICore/aiSwitch');
const untrusted = require('../AICore/untrusted');
const { getProvider, isAnyProviderConfigured } = require('../AICore/llmProvider');
const { parseModelJson } = require('../AICore/modelCall');
const { FEATURES } = require('../AICore/features');

const MIN_DESCRIPTION = 12;
const MAX_DESCRIPTION = 1000;
const NAME_MAX = 80;
const ABOUT_MAX = 500;
const WHY_MAX = 200;
const MAX_SKILLS = 4;
const MAX_PROJECTS_SHOWN = 100;
const MAX_TOKENS = 1200;
// Autonomy only goes up by a person's choice in the wizard: L1 proposes everything.
const SAFEST_AUTONOMY = 1;
const DEFAULT_SPEND_CAP_USD = 30;
const DEFAULT_ACTIONS = Object.freeze(['task.get', 'tasks.search', 'task.comment']);
const CADENCES = Object.freeze(['daily', 'weekly']);
const WHY_FIELDS = Object.freeze(['name', 'skills', 'actions', 'autonomy', 'scope', 'spendCap']);

const fail = (message, status) => Object.assign(new Error(message), { status });

const clip = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const listOf = (value) => (Array.isArray(value) ? value.map((v) => String(v || '').trim()).filter(Boolean) : []);

/* Owner/admin-only (gated) and propose-only actions are for a person to add by hand, never for a draft. */
const grantableActions = () => registry.manifest().actions.filter((a) => !a.proposeOnly && !a.gate && !registry.isNever(a.key));

const runnableSkills = async (companyId) => (await skillRecord.listSkills(companyId))
    .filter((s) => s.enabled !== false && !s.retiredAt && !s.unavailable);

const skillResolver = (skills) => {
    const byKey = new Map();
    skills.forEach((s) => { byKey.set(s.key, s.key); (s.aliases || []).forEach((alias) => byKey.set(alias, s.key)); });
    return (key) => byKey.get(key) || null;
};

const autonomyOf = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= SAFEST_AUTONOMY ? n : SAFEST_AUTONOMY;
};

const spendCapOf = (value) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, DEFAULT_SPEND_CAP_USD) : DEFAULT_SPEND_CAP_USD;
};

/* The draft the wizard opens with, and which of the model's choices were narrowed on the way. */
const sanitiseDraft = (raw, { skills, actions, projects }) => {
    const answer = raw && typeof raw === 'object' ? raw : {};
    const resolveSkill = skillResolver(skills);
    const grantable = new Set(actions.map((a) => a.key));
    const visible = new Set(projects.map((p) => String(p._id)));
    const emitsOf = new Map(skills.map((s) => [s.key, s.emits || []]));
    const adjusted = [];

    const askedSkills = listOf(answer.skills);
    const draftSkills = [...new Set(askedSkills.map(resolveSkill).filter(Boolean))].slice(0, MAX_SKILLS);
    if (draftSkills.length < askedSkills.length) adjusted.push('skills');

    const askedActions = listOf(answer.allowedActions);
    const keptActions = askedActions.filter((key) => grantable.has(key));
    if (keptActions.length < askedActions.length) adjusted.push('actions');
    const skillActions = draftSkills.flatMap((key) => emitsOf.get(key) || []).filter((key) => grantable.has(key));
    const base = keptActions.length ? keptActions : DEFAULT_ACTIONS.filter((key) => grantable.has(key));
    const allowedActions = [...new Set([...base, ...skillActions])];

    const autonomy = autonomyOf(answer.autonomy);
    if (autonomy !== Number(answer.autonomy)) adjusted.push('autonomy');

    const askedProjects = listOf(answer.projectIds);
    const projectIds = [...new Set(askedProjects.filter((id) => visible.has(id)))];
    if (projectIds.length < askedProjects.length) adjusted.push('scope');

    const spendCapUsd = spendCapOf(answer.spendCapUsd);
    if (answer.spendCapUsd !== undefined && spendCapUsd !== Number(answer.spendCapUsd)) adjusted.push('spendCap');

    const whyIn = answer.why && typeof answer.why === 'object' ? answer.why : {};
    const why = Object.fromEntries(WHY_FIELDS.map((field) => [field, adjusted.includes(field) ? '' : clip(whyIn[field], WHY_MAX)]));

    return {
        name: clip(answer.name, NAME_MAX),
        description: clip(answer.description, ABOUT_MAX),
        skills: draftSkills,
        allowedActions,
        autonomy,
        projectIds,
        spendCapUsd,
        cadence: CADENCES.includes(answer.cadence) ? answer.cadence : null,
        why,
        adjusted,
    };
};

const SYSTEM_PROMPT = [
    'You help a workspace manager set up an AI agent inside a project management tool.',
    'They describe the teammate they want in a sentence or two. You draft the agent: a short name, a one-line description, the skills it uses, the actions it may take, its autonomy, the projects it works in and a monthly spend cap.',
    '',
    'HARD RULES:',
    '- Use only skill keys from SKILLS and action keys from ACTIONS. Anything else is dropped.',
    '- Pick the fewest skills and actions that do the job.',
    '- Autonomy: 0 answers only, 1 suggests changes a person approves. Never higher; 1 unless the teammate only answers questions.',
    '- Projects: only ids from PROJECTS, and only the ones the description names or clearly means. None when unsure.',
    `- Spend cap: whole US dollars per month, at most ${DEFAULT_SPEND_CAP_USD}.`,
    '- cadence: "daily" or "weekly" when the description asks for a regular run, otherwise null.',
    '- "why": one short plain sentence per choice, addressed to the manager.',
    '',
    'Return ONLY JSON:',
    '{"name":"...","description":"...","skills":["key"],"allowedActions":["key"],"autonomy":1,"projectIds":["id"],"spendCapUsd":10,"cadence":null,',
    '"why":{"name":"...","skills":"...","actions":"...","autonomy":"...","scope":"...","spendCap":"..."}}',
].join('\n');

const userMessage = ({ description, skills, actions, projects }) => [
    'SKILLS:',
    ...skills.map((s) => `- ${s.key}: ${clip(s.description || s.name, 200)}${(s.emits || []).length ? ` (proposes: ${s.emits.join(', ')})` : ''}`),
    '',
    'ACTIONS:',
    ...actions.map((a) => `- ${a.key}: ${a.label}`),
    '',
    'PROJECTS:',
    ...(projects.length ? projects.map((p) => `- ${p._id}: ${clip(p.ProjectName, 120)}`) : ['(none)']),
    '',
    'DESCRIPTION:',
    untrusted.wrap(description),
].join('\n');

/* Throws with `status` for the controller: 400 input, 403 budget or AI off, 502 unusable answer, 503 no provider. */
const draftAgent = async ({ companyId, userId, description }) => {
    const text = clip(description, MAX_DESCRIPTION);
    if (text.length < MIN_DESCRIPTION) throw fail(`Describe the teammate in at least ${MIN_DESCRIPTION} characters.`, 400);
    await aiSwitch.assertAllowed(companyId);
    if (!isAnyProviderConfigured()) throw fail('No AI model is configured for this workspace.', 503);
    const allowance = await budget.check(companyId);
    if (!allowance.ok) throw fail(allowance.reason, 403);

    const [skills, projects] = await Promise.all([
        runnableSkills(companyId),
        scope.visibleProjects(companyId, userId).then((list) => (list || []).slice(0, MAX_PROJECTS_SHOWN)),
    ]);
    const actions = grantableActions();

    const result = await getProvider().chat({
        systemPrompt: untrusted.withNotice(SYSTEM_PROMPT),
        messages: [{ role: 'user', content: userMessage({ description: text, skills, actions, projects }) }],
        jsonMode: true,
        maxTokens: MAX_TOKENS,
        temperature: 0.2,
        spend: { feature: FEATURES.AGENT_BUILDER, companyId, userId },
    });
    const parsed = parseModelJson(result && result.content);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') throw fail('The model did not return a usable draft. Try again or pick a template.', 502);
    return sanitiseDraft(parsed.value, { skills, actions, projects });
};

module.exports = {
    MIN_DESCRIPTION, MAX_DESCRIPTION, WHY_MAX, SAFEST_AUTONOMY, DEFAULT_SPEND_CAP_USD,
    grantableActions, sanitiseDraft, draftAgent,
};
