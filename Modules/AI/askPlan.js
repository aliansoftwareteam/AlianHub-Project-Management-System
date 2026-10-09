const fs = require('fs');
const path = require('path');
const logger = require('../../Config/loggerConfig');
const aiSwitch = require('../AICore/aiSwitch');
const untrusted = require('../AICore/untrusted');
const usage = require('../AICore/usage');
const { FEATURES } = require('../AICore/features');
const { getProvider, isAnyProviderConfigured } = require('../AICore/llmProvider');
const { parseModelJson } = require('../AICore/modelCall');
const { requestAddress } = require('../../utils/requestAddress');
const { withTimeout } = require('./withTimeout');

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'ask-plan.md'), 'utf8')
    .replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();

const ASK_NAME = 'Ask';
const ASK_AGENT_ID = 'ask';
const TOOLS = Object.freeze(['task.create', 'fields.create', 'view.create', 'automation.create']);
const FIELD_SET = 'task.field.set';
const MAX_STEPS = 12;
const MAX_SENTENCE = 1000;
const MAX_PROJECTS = 30;
const MAX_LIST_PROJECTS = 10;
const MAX_LISTS = 40;
const MAX_MEMBERS = 150;
const MAX_TOKENS = 3000;
const REQUEST_TIMEOUT_MS = 60_000;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const CODE = Object.freeze({ AI_OFF: 'ai_off', NO_KEY: 'no_key', UNPRICED: 'unpriced', NOTHING: 'nothing_planned' });
const GATE_TEXT = Object.freeze({
    [CODE.AI_OFF]: 'AI is turned off, so a sentence cannot be planned.',
    [CODE.NO_KEY]: 'Planning needs an AI key on this server, or your own AI connected to AlianHub.',
    [CODE.UNPRICED]: 'The configured model has no price on file, so a sentence cannot be planned with it.',
});

/* Why a step was not planned. The server sends the code and the step's tool name; the client words both. */
const REASON = Object.freeze({
    OTHER_PROJECT: 'other_project', NO_PROJECT: 'no_project', NOT_ALLOWED: 'not_allowed', NOT_FOUND: 'not_found', INCOMPLETE: 'incomplete', REFUSED: 'refused',
});
const BAD_ARGUMENTS = -32602;

const tools = () => require('../Mcp/tools');
const str = (value, max) => String(value === undefined || value === null ? '' : value).slice(0, max);
const isId = (value) => OBJECT_ID.test(String(value || ''));

/* Why a sentence cannot be planned with the server's model, or '' when it can. Checked before anything is read or bought;
 * the spend meter (AICore/spend.js) refuses the same cases again at the call. */
const gateOf = async (companyId) => {
    if (!(await aiSwitch.allowed(companyId))) return CODE.AI_OFF;
    if (!isAnyProviderConfigured()) return CODE.NO_KEY;
    if (!usage.checkConfiguredModelPriced().ok) return CODE.UNPRICED;
    return '';
};

/* The person's own session as a caller: it acts through the registry as the workspace's Ask agent, for this person. */
const callerOf = (req, companyId, uid) => ({
    companyId,
    userId: uid,
    actor: { kind: 'agent', userId: uid, agentId: null, agentName: ASK_NAME, viaAccount: 'workspace', tokenId: null, runId: null },
    projectIds: [],
    ip: requestAddress(req),
});

const quietly = async (ctx, name, args) => {
    try {
        return await tools().readOwn(ctx, name, args);
    } catch (error) {
        return null;
    }
};

/* Where the MCP data tools are off, the projects the person can open, as Ask itself reads them. */
const openProjects = async (ctx) => {
    const { visibleProjects } = require('../Agents/scope');
    const rows = await visibleProjects(ctx.companyId, ctx.userId).catch(() => []);
    return rows.slice(0, MAX_PROJECTS).map((p) => ({ projectId: String(p._id), name: p.ProjectName || '' }));
};

const listsOf = async (ctx, projectId) => {
    const lists = await quietly(ctx, 'lists.list', { projectId });
    if (lists && Array.isArray(lists.lists)) return lists.lists.map((l) => ({ id: l.sprintId, name: l.name }));
    const sprints = await quietly(ctx, 'sprints.list', { projectId });
    return sprints && Array.isArray(sprints.sprints) ? sprints.sprints.map((l) => ({ id: l.sprintId || l.id, name: l.name })) : [];
};

/* What the model may name: the projects, lists and people the person's own connection would be shown, and nothing else. */
const placesOf = async (ctx, projectId) => {
    const listed = await quietly(ctx, 'projects.list', { limit: MAX_PROJECTS });
    const all = (listed && Array.isArray(listed.projects) ? listed.projects : await openProjects(ctx)).filter((p) => isId(p.projectId));
    const chosen = projectId ? all.filter((p) => p.projectId === projectId) : all;
    const withLists = chosen.slice(0, projectId ? 1 : MAX_LIST_PROJECTS);
    const lists = await Promise.all(withLists.map((p) => listsOf(ctx, p.projectId)));
    return chosen.map((p) => {
        const at = withLists.indexOf(p);
        return { id: p.projectId, name: str(p.name, 120), lists: at === -1 ? undefined : lists[at].filter((l) => isId(l.id)).slice(0, MAX_LISTS).map((l) => ({ id: l.id, name: str(l.name, 120) })) };
    });
};

const peopleOf = async (ctx) => {
    const found = await quietly(ctx, 'members.list', { limit: MAX_MEMBERS });
    return ((found && found.members) || []).filter((m) => isId(m.userId)).slice(0, MAX_MEMBERS).map((m) => ({ id: m.userId, name: str(m.name, 120) }));
};

const schemaOf = (tool) => {
    const properties = Object.fromEntries(Object.entries((tool.input && tool.input.properties) || {}).filter(([key]) => key !== 'reason'));
    return { name: tool.name, input: { ...tool.input, properties } };
};

const toolsOffered = () => TOOLS.map((name) => tools().planTool(name)).filter(Boolean);

const dayOf = (now) => `${now.toISOString().slice(0, 10)} (${now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })})`;

const dataFor = ({ places, people, offered, now }) => [
    `TODAY: ${dayOf(now)}`,
    `TOOLS: ${JSON.stringify(offered.map(schemaOf))}`,
    `PLACES (projects, each with its lists): ${JSON.stringify(places)}`,
    `PEOPLE: ${JSON.stringify(people)}`,
].join('\n');

/* The person's sentence is the request, so it travels after the data block and outside it; only workspace text is data. */
const messageFor = ({ sentence, ...data }) => `${untrusted.wrap(dataFor(data))}\n\nSENTENCE (the request, from the person):\n${untrusted.escape(sentence)}`;

const stepsOf = (raw) => {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.steps)) return null;
    return raw.steps
        .filter((s) => s && typeof s === 'object' && typeof s.tool === 'string')
        .slice(0, MAX_STEPS)
        .map((s) => ({ tool: s.tool, arguments: s.arguments && typeof s.arguments === 'object' && !Array.isArray(s.arguments) ? s.arguments : {} }));
};

const cannotOf = (raw) => (raw && Array.isArray(raw.cannot) ? raw.cannot : [])
    .filter((c) => c && typeof c === 'object')
    .slice(0, MAX_STEPS)
    .map((c) => ({ text: str(c.text, 300), reason: str(c.reason, 300) }));

const refusalOf = (step, error) => {
    const detail = str(error && (error.error || error.message), 400);
    const code = (error && error.code === BAD_ARGUMENTS && REASON.INCOMPLETE)
        || (/permission_denied|not allowed/i.test(detail) && REASON.NOT_ALLOWED)
        || (/not_visible|not_found|not found/i.test(detail) && REASON.NOT_FOUND)
        || REASON.REFUSED;
    return { step, code, detail };
};

/* The steps the model proposed, each taken as far as filing by the MCP road's own checks (schema, visibility, the
 * holder's permissions, the project's pause). A step that fails any of them is reported, never filed. */
const checked = async (ctx, steps, why) => {
    const ready = [];
    const cannot = [];
    for (const step of steps) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const out = await tools().planned(ctx, step.tool, { ...step.arguments, reason: why });
            if (out.answer) cannot.push(refusalOf(step.tool, { error: out.answer.error || out.answer.message }));
            else ready.push({ tool: out.tool, params: out.params, step: step.tool });
        } catch (error) {
            cannot.push(refusalOf(step.tool, error));
        }
    }
    return { ready, cannot };
};

/* A proposal waits in one project, so the steps that reach another are left for a sentence of their own. */
const inOneProject = async (companyId, ready) => {
    const { projectsOf } = require('../Agents/projectPolicy');
    const reached = await Promise.all(ready.map((r) => projectsOf(companyId, r.params)));
    const first = reached.find((ids) => ids.length);
    const home = first ? first[0] : null;
    const kept = [];
    const left = [];
    ready.forEach((r, at) => {
        const ids = reached[at];
        if (!home || (ids.length === 1 && ids[0] === home)) kept.push(r);
        else left.push({ step: r.step, code: ids.length ? REASON.OTHER_PROJECT : REASON.NO_PROJECT });
    });
    return { kept, left, projectId: home };
};

/* fields.create sets the values it was given through task.field.set, so only a change carrying values needs that action. */
const setsValues = ({ params }) => {
    const values = params && params.values;
    return Array.isArray(values) ? values.length > 0 : values !== undefined && values !== null;
};

const fileProposal = async (ctx, { projectId, summary, ready }) => {
    const proposals = require('../Agents/proposals');
    const actions = require('../Agents/actions');
    const { toolLabel } = require('../Agents/changeLabels');
    const changes = ready.map(({ tool, params }) => ({ action: tool.action, params, label: toolLabel(tool.name), rating: actions.rating(tool.action) }));
    const allowedActions = [...new Set([...changes.map((c) => c.action), ...(changes.some(setsValues) ? [FIELD_SET] : [])])];
    return proposals.create(ctx.companyId, {
        agent: { _id: ASK_AGENT_ID, name: ASK_NAME },
        projectId,
        what: summary,
        why: 'Planned from a sentence typed in the Ask box.',
        changes,
        source: proposals.SOURCE_ASK,
        requestedBy: ctx.userId,
        allowedActions,
    });
};

const cardsOf = async (companyId, uid, proposal) => {
    const intentPreview = require('../Agents/intentPreview');
    const cards = await intentPreview.forProposals(companyId, uid, [proposal]).catch((error) => {
        logger.error(`ask plan cards: ${error.message}`);
        return new Map();
    });
    return cards.get(String(proposal._id)) || [];
};

const unplanned = (code, extra = {}) => ({
    status: true,
    statusText: GATE_TEXT[code] || 'Nothing could be planned.',
    data: { configured: code === CODE.NOTHING, planned: false, code, ...extra },
});

/* POST /api/v1/ai/ask/plan  body: { sentence, projectId? }
 * One sentence becomes one proposal, filed for the person to approve in the Ask box or the Inbox. Nothing is made here. */
const planSentence = async (req, { sentence, projectId } = {}, { now = new Date() } = {}) => {
    const companyId = String(req.headers['companyid'] || '');
    const uid = String(req.uid || '');
    if (!companyId || !uid) return { status: false, statusText: 'companyId and an authenticated user are required.', code: 'unauthenticated' };
    const asked = str(sentence, MAX_SENTENCE + 1).trim();
    if (!asked) return { status: false, statusText: 'Say what to set up first.', code: 'question_required' };
    if (asked.length > MAX_SENTENCE) return { status: false, statusText: `Keep it to ${MAX_SENTENCE} characters.`, code: 'too_long' };

    const gate = await gateOf(companyId);
    if (gate) return unplanned(gate);

    const ctx = callerOf(req, companyId, uid);
    const offered = toolsOffered();
    if (!offered.length) return unplanned(CODE.NOTHING, { cannot: [] });
    const scoped = isId(projectId) ? String(projectId).toLowerCase() : '';
    const [places, people] = await Promise.all([placesOf(ctx, scoped), peopleOf(ctx)]);
    if (scoped && !places.length) return { status: false, statusText: 'That project was not found.', code: 'project_not_found' };

    const result = await withTimeout(getProvider().chat({
        systemPrompt: untrusted.withNotice(SYSTEM_PROMPT),
        messages: [{ role: 'user', content: messageFor({ sentence: asked, places, people, offered, now }) }],
        jsonMode: true,
        temperature: 0.1,
        maxTokens: MAX_TOKENS,
        spend: { feature: FEATURES.ASK, companyId, userId: uid },
    }), REQUEST_TIMEOUT_MS, 'The AI request timed out.');

    const usedBy = { tokens: result.totalTokens, model: result.model };
    const parsed = parseModelJson(result.content);
    const steps = parsed.ok ? stepsOf(parsed.value) : null;
    if (!steps) return unplanned(CODE.NOTHING, { cannot: [], unreadable: true, usage: usedBy });

    const summary = str(parsed.value.summary, 200).trim() || 'Changes planned in the Ask box';
    const cannot = cannotOf(parsed.value);
    const vetted = await checked(ctx, steps, summary);
    const { kept, left, projectId: home } = await inOneProject(companyId, vetted.ready);
    const notPlanned = [...cannot, ...vetted.cannot, ...left];
    if (!kept.length) return unplanned(CODE.NOTHING, { cannot: notPlanned, usage: usedBy });

    const proposal = await fileProposal(ctx, { projectId: home, summary, ready: kept });
    return {
        status: true,
        statusText: 'Planned.',
        data: {
            configured: true,
            planned: true,
            proposalId: String(proposal._id),
            summary,
            changes: await cardsOf(companyId, uid, proposal),
            cannot: notPlanned,
            usage: usedBy,
        },
    };
};

const plan = async (req, res) => {
    try {
        const body = req.body || {};
        return res.send(await planSentence(req, { sentence: body.sentence, projectId: body.projectId }));
    } catch (error) {
        logger.error(`ai ask plan: ${error.message}`);
        if (aiSwitch.isAiOff(error)) return res.send(unplanned(CODE.AI_OFF));
        if (error && error.code === usage.UNPRICED_MODEL) return res.send(unplanned(CODE.UNPRICED));
        return res.send({ status: false, statusText: 'The sentence could not be planned just now. Try again.', code: 'plan_failed' });
    }
};

module.exports = { plan, planSentence, gateOf, CODE, REASON, TOOLS, MAX_SENTENCE, ASK_AGENT_ID };
