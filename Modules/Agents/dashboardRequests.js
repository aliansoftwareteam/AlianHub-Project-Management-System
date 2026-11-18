const tools = require('../Automations/engine/tools');
const setup = require('./setupRequests');
const { whoOf } = require('./taskRequests');

// One card on a dashboard, added the way its owner adds one in the dashboard editor: the editor's own routes,
// called as the person who approved. A dashboard is changed by its owner alone, so the person the agent works for
// is the only one who can approve, and the only one who can take the card back. A new dashboard is made private,
// with the card on it, for that person.

const ACTION = 'dashboard.card.add';
const UNDO_KIND = 'dashboardCard';
const NAME_MAX = 120;
const CARDS_MAX = 60;
const PLAN_CARDS_MAX = 6;
const PRIVATE = 'private';
const WORKSPACE = 'workspace';
const PROJECT = 'project';
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const slot = (w, h, minW, minH, maxH = 22) => Object.freeze({ w, h, minW, maxW: 12, minH, maxH });

/* The cards the editor's picker adds with nothing more to fill in, each as the picker adds it: its component, its
 * place in the grid and the span of time it starts on (frontend/src/plugins/dashboard/cardCatalog.js; a test holds
 * the two together). A card that first asks for a project, a list or a question is added in AlianHub. */
const CARDS = Object.freeze({
    due_soon: { key: 'DueSoonCard', size: slot(4, 9, 3, 7), period: null },
    my_time: { key: 'MyTimeCard', size: slot(4, 8, 3, 6, 18), period: 3 },
    project_pulse: { key: 'ProjectPulseCard', size: slot(6, 9, 4, 7), period: 1 },
    logged_vs_estimate: { key: 'TeamLoggedVsEtaCard', size: slot(6, 10, 4, 7), period: 3 },
    free_capacity: { key: 'FreeResourcesCard', size: slot(6, 9, 4, 6), period: null },
    at_risk: { key: 'AtRiskTodayCard', size: slot(6, 10, 4, 7), period: null },
    tasks_by_status: { key: 'TasksByStatusCard', size: slot(6, 9, 4, 6), period: 3 },
    agent_spend: { key: 'AgentSpendCard', size: slot(6, 9, 4, 6), period: null },
});
const PERIODS = Object.freeze({ auto: 0, today: 1, this_week: 3, last_week: 4, this_month: 5, last_month: 6, last_30_days: 8 });

const NOT_FOUND = 'That dashboard was not found.';
const NOT_OWNER = 'Only the owner of a dashboard can change it, and this one belongs to someone else.';
const FULL = `That dashboard already has ${CARDS_MAX} cards, which is the most it can have.`;
const NOT_THEIRS = 'A dashboard is changed by its owner alone, so only the person this card was asked for can approve it.';
const CHANGED_SINCE = 'it was changed after the plan made it';

const refuse = (message) => new tools.DeterministicError(message);
const idOf = (value) => (value === undefined || value === null ? '' : String(value));
const isId = (value) => OBJECT_ID.test(idOf(value));
const objectOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const listOf = (value) => (Array.isArray(value) ? value : []);

/* What a caller names, kept to what the editor takes: a dashboard that is there or the name of a new one, a card
 * of the picker, and the span of time for a card that covers one. */
const draftOf = (given) => {
    const asked = objectOf(given);
    const name = setup.lineOf(asked.newDashboard, NAME_MAX);
    const card = Object.hasOwn(CARDS, idOf(asked.card)) ? idOf(asked.card) : '';
    return {
        ...(isId(asked.dashboardId) ? { dashboardId: idOf(asked.dashboardId).toLowerCase() } : {}),
        ...(name ? { newDashboard: name } : {}),
        card,
        ...(Object.hasOwn(PERIODS, idOf(asked.period)) ? { period: idOf(asked.period) } : {}),
    };
};

const problemIn = (given) => {
    const asked = objectOf(given);
    const draft = draftOf(asked);
    if (Boolean(draft.dashboardId) === Boolean(draft.newDashboard)) return 'Give either dashboardId (an existing dashboard) or newDashboard (the name of a new one), not both and not neither.';
    if (!draft.card) return `The card must be one of ${Object.keys(CARDS).join(', ')}.`;
    if (asked.period !== undefined && !draft.period) return `The period must be one of ${Object.keys(PERIODS).join(', ')}.`;
    return draft.period && CARDS[draft.card].period === null ? `A ${draft.card} card does not cover a span of time, so leave the period out.` : '';
};

const answered = (answer) => (answer.code === 200 && answer.body && answer.body.status === true ? answer.body.data : null);

/* The dashboard as the editor loads it for `who`, or why that person cannot change it. One they cannot open
 * answers as one that is not there. */
const editable = async (companyId, who, dashboardId) => {
    const dashboard = answered(await setup.answerOf('dashboardRead', { companyId, who, params: { id: dashboardId } }));
    if (!dashboard) return { error: NOT_FOUND };
    return dashboard.canEdit === true ? { dashboard } : { error: NOT_OWNER };
};

const human = (uid) => ({ uid: idOf(uid), via: '', mark: null });

/* What stops the card from being added for `uid` by hand, or ''. */
const refusalFor = async (companyId, uid, draft) => {
    if (!draft.dashboardId) return '';
    const held = await editable(companyId, human(uid), draft.dashboardId);
    if (held.error) return held.error;
    return listOf(held.dashboard.cards).length >= CARDS_MAX ? FULL : '';
};

/* '' where `approverId` is the person the card was asked for; otherwise why they cannot approve it. */
const approverRefusal = (approverId, requesterId) => (idOf(approverId) && idOf(approverId) === idOf(requesterId) ? '' : NOT_THEIRS);

const cardUid = () => String(Math.floor(100000000 + Math.random() * 900000000));

const bottomOf = (card) => {
    const at = objectOf(objectOf(card.config).position);
    return (Number(at.y) || 0) + (Number(at.h) || 0);
};

/* The card as the editor saves a new one, under the cards already there. */
const cardDoc = (draft, cards) => {
    const kind = CARDS[draft.card];
    const bottom = listOf(cards).reduce((most, card) => Math.max(most, bottomOf(objectOf(card))), 0);
    const timerange = draft.period ? PERIODS[draft.period] : kind.period;
    return {
        componentId: kind.key, cardId: '', uid: cardUid(),
        config: { cardData: timerange === null ? {} : { timerange }, filterData: [], position: { x: 0, y: bottom, ...kind.size } },
    };
};

const addressOf = (companyId, dashboardId) => {
    const base = require('../Mcp/screenTools').webBase();
    return base ? `${base}/#/${encodeURIComponent(String(companyId))}/dashboards/${dashboardId}` : '';
};

/* The agent log is read by owners and admins, so it names a dashboard only where the whole workspace sees it. */
const nameForLog = (dashboard) => (dashboard.visibility === WORKSPACE ? dashboard.title || '' : '');

const addToNew = async ({ companyId, who, draft }) => {
    const card = cardDoc(draft, []);
    const answer = await setup.answerOf('dashboardCreate', { companyId, who, body: { title: draft.newDashboard, visibility: PRIVATE, cards: [card] } });
    const made = answered(answer);
    if (!made || !made._id) throw refuse(setup.reasonOf(answer, 'The dashboard was not created. Try again, or tell the person.'));
    return { dashboardId: idOf(made._id), named: '', cardUid: card.uid, madeDashboard: true };
};

const addToHeld = async ({ companyId, who, draft }) => {
    const held = await editable(companyId, who, draft.dashboardId);
    if (held.error) throw refuse(held.error);
    const cards = listOf(held.dashboard.cards);
    if (cards.length >= CARDS_MAX) throw refuse(FULL);
    const card = cardDoc(draft, cards);
    const answer = await setup.answerOf('dashboardCards', { companyId, who, params: { id: draft.dashboardId }, body: { cards: [...cards, card] } });
    if (!answered(answer)) throw refuse(setup.reasonOf(answer, 'The card was not added. Try again, or tell the person.'));
    return { dashboardId: draft.dashboardId, named: nameForLog(held.dashboard), cardUid: card.uid, madeDashboard: false };
};

/* Taking the card back, as the person undoing, who must own the dashboard. A dashboard the change made goes with
 * its card while that card is still all it holds; one that has gained a card since, or was there before, stays. */
const withdraw = async ({ companyId, who, made }) => {
    const held = await editable(companyId, who, made.dashboardId);
    if (held.error) throw refuse(held.error);
    const cards = listOf(held.dashboard.cards);
    const kept = cards.filter((card) => idOf(card.uid) !== idOf(made.cardUid));
    if (kept.length === cards.length) return { dashboardId: made.dashboardId, removed: false };
    const whole = made.madeDashboard === true && !kept.length;
    const answer = whole
        ? await setup.answerOf('dashboardDelete', { companyId, who, params: { id: made.dashboardId } })
        : await setup.answerOf('dashboardCards', { companyId, who, params: { id: made.dashboardId }, body: { cards: kept } });
    if (!answered(answer)) throw refuse(setup.reasonOf(answer, 'The card was not removed. Try again, or tell the person.'));
    return { dashboardId: made.dashboardId, removed: true, dashboardRemoved: whole };
};

const timeOf = (value) => {
    const at = value ? new Date(value).getTime() : 0;
    return Number.isFinite(at) ? at : 0;
};

/* The dashboard a plan names, kept to what a plan takes: a name, and cards of the picker, each once. */
const planDashboardOf = (given) => {
    const asked = objectOf(given);
    return { name: setup.lineOf(asked.name, NAME_MAX), cards: [...new Set(listOf(asked.cards).map(idOf))] };
};

/* '' for a dashboard a plan can ask for; otherwise what is wrong with it. */
const planDashboardProblem = (given) => {
    const asked = objectOf(given);
    if (!planDashboardOf(asked).name) return 'dashboard needs a name';
    const cards = listOf(asked.cards).map(idOf);
    if (!cards.length || cards.length > PLAN_CARDS_MAX) return `dashboard needs 1 to ${PLAN_CARDS_MAX} cards`;
    const other = cards.find((card) => !Object.hasOwn(CARDS, card));
    if (other !== undefined) return `dashboard: "${other}" is not a card; a card is one of ${Object.keys(CARDS).join(', ')}`;
    return new Set(cards).size < cards.length ? 'dashboard names a card twice' : '';
};

/* The line a plan's card shows for its dashboard, each card named by the component the editor draws. */
const planLine = (given, pick) => {
    const dashboard = planDashboardOf(given);
    if (!dashboard.name) return null;
    return { kind: 'planDashboard', name: dashboard.name, cards: dashboard.cards.filter((card) => Object.hasOwn(CARDS, card)).map((card) => CARDS[card].key), pick };
};

/* A plan's dashboard, made by the editor's route as `who`, who owns it: shown to everyone on the project where they
 * can open it, which is what the route asks of a project dashboard, and private to them otherwise. */
const makeForPlan = async ({ companyId, who, projectId, dashboard }) => {
    const { visibleProjectIds } = require('../UserDashboard/controller');
    const shared = (await visibleProjectIds(companyId, who.uid)).includes(idOf(projectId));
    const cards = dashboard.cards.reduce((made, card) => [...made, cardDoc({ card }, made)], []);
    const body = { title: dashboard.name, visibility: shared ? PROJECT : PRIVATE, ...(shared ? { projectId: idOf(projectId) } : {}), cards };
    const answer = await setup.answerOf('dashboardCreate', { companyId, who, body });
    const made = answered(answer);
    if (!made || !made._id) throw refuse(setup.reasonOf(answer, 'The dashboard was not created.'));
    return { dashboardId: idOf(made._id), name: made.title || dashboard.name, shared: made.visibility === PROJECT, savedAt: timeOf(made.updatedAt) };
};

/* Taking a plan's dashboard back, as the person undoing, who must own it. One that is gone already is left at that;
 * one changed since the plan made it stays, with why. */
const withdrawForPlan = async ({ companyId, who, made }) => {
    const held = await editable(companyId, who, made.dashboardId);
    if (held.error === NOT_FOUND) return { removed: false, name: '' };
    if (held.error) return { removed: false, name: '', reason: held.error };
    const name = held.dashboard.title || '';
    if (timeOf(held.dashboard.updatedAt) !== Number(made.savedAt || 0)) return { removed: false, name, reason: CHANGED_SINCE };
    const answer = await setup.answerOf('dashboardDelete', { companyId, who, params: { id: made.dashboardId } });
    if (!answered(answer)) return { removed: false, name, reason: setup.reasonOf(answer, 'the dashboard was not removed') };
    return { removed: true, name };
};

const mayWithdraw = async (companyId, uid, dashboardId) => !(await editable(companyId, human(uid), dashboardId)).error;

/* The card's lines, for a viewer who can open the dashboard; a dashboard that is not there yet is the proposal's own text. */
const preview = async (change, { companyId, uid }) => {
    const draft = draftOf(change.params);
    if (problemIn(draft)) return null;
    const dashboard = draft.dashboardId ? answered(await setup.answerOf('dashboardRead', { companyId, who: human(uid), params: { id: draft.dashboardId } })) : null;
    if (draft.dashboardId && !dashboard) return null;
    const name = dashboard ? dashboard.title || '' : draft.newDashboard;
    const period = draft.period ? PERIODS[draft.period] : CARDS[draft.card].period;
    return {
        kind: 'dashboardCard',
        title: name,
        lines: [{ kind: 'dashboard', name, isNew: !dashboard }, { kind: 'card', card: CARDS[draft.card].key, ...(period === null ? {} : { period }) }],
    };
};

const executors = {
    async [ACTION]({ companyId, actor, params, depth, approvedBy }) {
        const requester = whoOf(actor, depth);
        const stopped = approverRefusal(approvedBy, requester.uid);
        if (stopped) throw refuse(stopped);
        const problem = problemIn(params);
        if (problem) throw refuse(problem);
        const draft = draftOf(params);
        const made = draft.dashboardId ? await addToHeld({ companyId, who: requester, draft }) : await addToNew({ companyId, who: requester, draft });
        const url = addressOf(companyId, made.dashboardId);
        return {
            result: { dashboardId: made.dashboardId, card: draft.card, madeDashboard: made.madeDashboard, ...(url ? { url } : {}) },
            undo: { kind: UNDO_KIND, dashboardId: made.dashboardId, cardUid: made.cardUid, madeDashboard: made.madeDashboard },
            entityType: 'dashboard', entityId: made.dashboardId, entityName: made.named,
        };
    },
};

const inverses = {
    [UNDO_KIND]: (companyId, made, actor) => withdraw({ companyId, who: whoOf(actor), made }),
};

module.exports = {
    executors, inverses, draftOf, problemIn, refusalFor, approverRefusal, mayWithdraw, preview, planDashboardOf, planDashboardProblem, planLine, makeForPlan, withdrawForPlan,
    ACTION, UNDO_KIND, CARDS, PERIODS, NAME_MAX, PLAN_CARDS_MAX, NOT_THEIRS, CHANGED_SINCE,
};
