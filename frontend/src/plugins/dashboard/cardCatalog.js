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
    { id: 'mine', labelKey: 'DashV2.family_mine', questionKey: 'DashV2.family_mine_q' },
    { id: 'team', labelKey: 'DashV2.family_team', questionKey: 'DashV2.family_team_q' },
    { id: 'charts', labelKey: 'DashV2.family_charts', questionKey: 'DashV2.family_charts_q' },
    { id: 'ai', labelKey: 'DashV2.family_ai', questionKey: 'DashV2.family_ai_q' },
];

export const PERIOD_OPTIONS = [
    { id: 0, labelKey: 'DashV2.period_auto' },
    { id: 1, labelKey: 'DashV2.period_today' },
    { id: 3, labelKey: 'DashV2.period_this_week' },
    { id: 4, labelKey: 'DashV2.period_last_week' },
    { id: 5, labelKey: 'DashV2.period_this_month' },
    { id: 6, labelKey: 'DashV2.period_last_month' },
    { id: 8, labelKey: 'DashV2.period_last_30' },
];

const card = (key, family, built, extra = {}) => ({
    key,
    family,
    built,
    titleKey: `DashV2.card_${key}_title`,
    answerKey: `DashV2.card_${key}_answer`,
    scopeKey: extra.scopeKey || 'DashV2.scope_workspace',
    size: extra.size || { w: 6, h: 8, minW: 3, maxW: 12, minH: 5, maxH: 22 },
    period: extra.period ?? null,
    ...extra,
});

export const CARD_CATALOG = [
    card('DueSoonCard', 'mine', true, {
        scopeKey: 'DashV2.scope_mine',
        size: { w: 4, h: 9, minW: 3, maxW: 12, minH: 7, maxH: 22 },
        link: { name: 'Home', labelKey: 'DashV2.link_my_tasks' },
        emptyKey: 'DashV2.empty_due_soon',
        emptyActionKey: 'DashV2.action_open_my_work',
    }),
    card('MyTimeCard', 'mine', true, {
        scopeKey: 'DashV2.scope_mine',
        size: { w: 4, h: 8, minW: 3, maxW: 12, minH: 6, maxH: 18 },
        period: 3,
        link: { name: 'LogTime', labelKey: 'DashV2.link_timesheet' },
        emptyKey: 'DashV2.empty_my_time',
        emptyActionKey: 'DashV2.action_log_time',
    }),
    card('NextUpCard', 'mine', false),
    card('MyAchievementsCard', 'mine', false),
    card('MyLeaveCard', 'mine', false),
    card('SavedSearchCard', 'mine', false),

    card('ProjectPulseCard', 'team', true, {
        size: { w: 6, h: 9, minW: 4, maxW: 12, minH: 7, maxH: 22 },
        period: 1,
        link: { name: 'Projects', labelKey: 'DashV2.link_projects' },
        emptyKey: 'DashV2.empty_project_pulse',
        emptyActionKey: 'DashV2.action_open_projects',
    }),
    card('TeamLoggedVsEtaCard', 'team', true, {
        scopeKey: 'DashV2.scope_team',
        size: { w: 6, h: 10, minW: 4, maxW: 12, minH: 7, maxH: 22 },
        period: 3,
        link: { name: 'LogTime', labelKey: 'DashV2.link_timesheet' },
        emptyKey: 'DashV2.empty_logged_vs_eta',
        emptyActionKey: 'DashV2.action_log_time',
    }),
    card('FreeResourcesCard', 'team', true, {
        scopeKey: 'DashV2.scope_team',
        size: { w: 6, h: 9, minW: 4, maxW: 12, minH: 6, maxH: 22 },
        link: { name: 'CapacityPlanning', labelKey: 'DashV2.link_capacity' },
        emptyKey: 'DashV2.empty_free_capacity',
        emptyActionKey: 'DashV2.action_open_capacity',
    }),
    card('LiveWorkTableCard', 'team', false),
    card('OnLeaveCard', 'team', false),
    card('TeamCategoryBreakdownCard', 'team', false),
    card('EmployeeWorkloadReportCard', 'team', false),

    card('TasksByStatusCard', 'charts', true, {
        size: { w: 6, h: 9, minW: 4, maxW: 12, minH: 6, maxH: 22 },
        period: 3,
        link: { name: 'Projects', labelKey: 'DashV2.link_projects' },
        emptyKey: 'DashV2.empty_tasks_by_status',
        emptyActionKey: 'DashV2.action_open_projects',
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
