/**
 * The dashboard card catalogue (handoff 20a–20d).
 *
 * Grouped by what a card answers, not by chart type. `built: true` means the card
 * is implemented and can be added; everything else is listed so the shape of the
 * product is visible, and is refused by the picker until it exists.
 *
 * `scope` is the mono tag in the card header — whose data this is.
 * `size` is the card's slot in the 12-column grid.
 */

export const CARD_FAMILIES = [
    { id: 'mine', labelKey: 'Dash.family_mine', questionKey: 'Dash.family_mine_q' },
    { id: 'team', labelKey: 'Dash.family_team', questionKey: 'Dash.family_team_q' },
    { id: 'charts', labelKey: 'Dash.family_charts', questionKey: 'Dash.family_charts_q' },
    { id: 'ai', labelKey: 'Dash.family_ai', questionKey: 'Dash.family_ai_q' },
];

export const PERIOD_OPTIONS = [
    { id: 0, labelKey: 'Dash.period_auto' },
    { id: 1, labelKey: 'Dash.period_today' },
    { id: 3, labelKey: 'Dash.period_this_week' },
    { id: 4, labelKey: 'Dash.period_last_week' },
    { id: 5, labelKey: 'Dash.period_this_month' },
    { id: 6, labelKey: 'Dash.period_last_month' },
    { id: 8, labelKey: 'Dash.period_last_30' },
];

const card = (key, family, built, extra = {}) => ({
    key,
    family,
    built,
    titleKey: `Dash.card_${key}_title`,
    answerKey: `Dash.card_${key}_answer`,
    scopeKey: extra.scopeKey || 'Dash.scope_workspace',
    size: extra.size || { w: 6, h: 8, minW: 3, maxW: 12, minH: 5, maxH: 22 },
    period: extra.period ?? null,
    ...extra,
});

export const CARD_CATALOG = [
    card('DueSoonCard', 'mine', true, {
        scopeKey: 'Dash.scope_mine',
        size: { w: 4, h: 9, minW: 3, maxW: 12, minH: 7, maxH: 22 },
        link: { name: 'Home', labelKey: 'Dash.link_my_tasks' },
        emptyKey: 'Dash.empty_due_soon',
        emptyActionKey: 'Dash.action_open_my_work',
    }),
    card('MyTimeCard', 'mine', true, {
        scopeKey: 'Dash.scope_mine',
        size: { w: 4, h: 8, minW: 3, maxW: 12, minH: 6, maxH: 18 },
        period: 3,
        link: { name: 'LogTime', labelKey: 'Dash.link_timesheet' },
        emptyKey: 'Dash.empty_my_time',
        emptyActionKey: 'Dash.action_log_time',
    }),
    card('NextUpCard', 'mine', false),
    card('MyAchievementsCard', 'mine', false),
    card('MyLeaveCard', 'mine', false),
    card('SavedSearchCard', 'mine', false),

    card('ProjectPulseCard', 'team', true, {
        size: { w: 6, h: 9, minW: 4, maxW: 12, minH: 7, maxH: 22 },
        period: 1,
        link: { name: 'Projects', labelKey: 'Dash.link_projects' },
        emptyKey: 'Dash.empty_project_pulse',
        emptyActionKey: 'Dash.action_open_projects',
    }),
    card('TeamLoggedVsEtaCard', 'team', true, {
        scopeKey: 'Dash.scope_team',
        size: { w: 6, h: 10, minW: 4, maxW: 12, minH: 7, maxH: 22 },
        period: 3,
        link: { name: 'LogTime', labelKey: 'Dash.link_timesheet' },
        emptyKey: 'Dash.empty_logged_vs_eta',
        emptyActionKey: 'Dash.action_log_time',
    }),
    card('FreeResourcesCard', 'team', true, {
        scopeKey: 'Dash.scope_team',
        size: { w: 6, h: 9, minW: 4, maxW: 12, minH: 6, maxH: 22 },
        link: { name: 'CapacityPlanning', labelKey: 'Dash.link_capacity' },
        emptyKey: 'Dash.empty_free_capacity',
        emptyActionKey: 'Dash.action_open_capacity',
    }),
    card('AtRiskTodayCard', 'team', true, {
        size: { w: 6, h: 10, minW: 4, maxW: 12, minH: 7, maxH: 22 },
        link: { name: 'Projects', labelKey: 'Dash.link_projects' },
        emptyKey: 'Dash.empty_at_risk',
        emptyActionKey: 'Dash.action_open_projects',
    }),
    card('LiveWorkTableCard', 'team', false),
    card('OnLeaveCard', 'team', false),
    card('TeamCategoryBreakdownCard', 'team', false),
    card('EmployeeWorkloadReportCard', 'team', false),

    card('TasksByStatusCard', 'charts', true, {
        size: { w: 6, h: 9, minW: 4, maxW: 12, minH: 6, maxH: 22 },
        period: 3,
        link: { name: 'Projects', labelKey: 'Dash.link_projects' },
        emptyKey: 'Dash.empty_tasks_by_status',
        emptyActionKey: 'Dash.action_open_projects',
    }),
    card('TaskStatusSummaryCard', 'charts', false),
    card('WorkedTasksTableCard', 'charts', false),
    card('BurndownCard', 'charts', true, {
        scopeKey: 'Dash.scope_project',
        size: { w: 6, h: 10, minW: 4, maxW: 12, minH: 8, maxH: 22 },
        link: { name: 'SprintReport', labelKey: 'Dash.link_sprint_report' },
        emptyKey: 'Dash.burndown_pick_sprint',
        settings: [
            { name: 'projectId', type: 'project', required: true, labelKey: 'Dash.project' },
            { name: 'sprintId', type: 'sprint', required: true, labelKey: 'Dash.settings_sprint' },
            { name: 'metric', type: 'choice', labelKey: 'Dash.settings_metric', options: [{ id: 'points', labelKey: 'Dash.metric_points' }, { id: 'count', labelKey: 'Dash.metric_tasks' }] },
        ],
    }),
    card('VelocityCard', 'charts', true, {
        scopeKey: 'Dash.scope_project',
        size: { w: 6, h: 9, minW: 4, maxW: 12, minH: 7, maxH: 22 },
        link: { name: 'VelocityFlow', labelKey: 'Dash.link_velocity' },
        emptyKey: 'Dash.velocity_pick_project',
        settings: [
            { name: 'projectId', type: 'project', required: true, labelKey: 'Dash.project' },
            { name: 'sprintCount', type: 'count', min: 2, max: 12, default: 6, labelKey: 'Dash.settings_sprint_count' },
        ],
    }),
    card('MilestoneReportCard', 'charts', false),
    card('TasksByAssigneeCard', 'charts', false),

    card('AgentSpendCard', 'ai', true, {
        size: { w: 6, h: 9, minW: 4, maxW: 12, minH: 6, maxH: 22 },
        link: { name: 'AiHub', labelKey: 'Dash.link_agents' },
        emptyKey: 'Dash.empty_agent_spend',
        emptyActionKey: 'Dash.action_open_agents',
    }),
    card('AskAQuestionCard', 'ai', true, {
        scopeKey: 'Dash.scope_mine',
        size: { w: 6, h: 10, minW: 4, maxW: 12, minH: 7, maxH: 22 },
        link: { name: 'AiAsk', labelKey: 'Dash.link_ask' },
        emptyKey: 'Dash.ask_pick_question',
        settings: [
            { name: 'question', type: 'text', required: true, maxLength: 500, labelKey: 'Dash.settings_question', placeholderKey: 'Dash.settings_question_placeholder', hintKey: 'Dash.settings_question_hint' },
            { name: 'projectId', type: 'project', labelKey: 'Dash.settings_ask_project' },
        ],
    }),
];

export const BUILT_CARDS = CARD_CATALOG.filter((c) => c.built);

export const catalogEntry = (key) => CARD_CATALOG.find((c) => c.key === key) || null;

export const isBuiltCard = (key) => BUILT_CARDS.some((c) => c.key === key);
