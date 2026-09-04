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
    card('BurndownCard', 'charts', false),
    card('VelocityCard', 'charts', false),
    card('MilestoneReportCard', 'charts', false),
    card('TasksByAssigneeCard', 'charts', false),

    card('AtRiskTodayCard', 'ai', false),
    card('AgentSpendCard', 'ai', false),
    card('AskAQuestionCard', 'ai', false),
];

export const BUILT_CARDS = CARD_CATALOG.filter((c) => c.built);

export const catalogEntry = (key) => CARD_CATALOG.find((c) => c.key === key) || null;

export const isBuiltCard = (key) => BUILT_CARDS.some((c) => c.key === key);
