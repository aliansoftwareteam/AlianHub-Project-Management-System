// Part keys must match Modules/AIProjectGenerator/planPicks.js: tasks are counted across the lists in order.

const listOf = (value) => (Array.isArray(value) ? value : []);
const textOf = (value) => (typeof value === 'string' ? value.trim() : '');

export const cardOf = (plan, { withGuide = false } = {}) => {
    if (!plan || !plan.project) return null;
    const sprints = listOf(plan.sprints);
    const needs = {};
    const taskLines = sprints.flatMap((sprint, list) => listOf(sprint?.tasks).map((task) => ({ task, list, sprintName: textOf(sprint?.sprintName) })))
        .map(({ task, list, sprintName }, at) => {
            needs[`tasks:${at}`] = [`lists:${list}`];
            return { kind: 'planTask', name: textOf(task?.TaskName), list: sprintName, pick: `tasks:${at}` };
        });
    const lines = [
        sprints.length && { kind: 'newLists', names: sprints.map((sprint) => textOf(sprint?.sprintName)), picks: sprints.map((sprint, at) => `lists:${at}`) },
        ...taskLines,
        ...listOf(plan.views).map((view, at) => ({ kind: 'planView', name: textOf(view?.name), layout: textOf(view?.kind), pick: `views:${at}` })),
        plan.dashboard && { kind: 'planDashboard', name: textOf(plan.dashboard.name), cards: listOf(plan.dashboard.cardKeys), pick: 'dashboards:0' },
        ...listOf(plan.rules).map((rule, at) => ({ kind: 'planRule', text: textOf(rule?.sentence) || textOf(rule?.name), pick: `rules:${at}` })),
        withGuide && { kind: 'planAgent', project: textOf(plan.project.ProjectName), pick: 'agents:0' },
    ].filter(Boolean);
    const keys = new Set(lines.flatMap((line) => (line.picks ? line.picks : [line.pick])));
    const locked = listOf(plan.locked).filter((key) => keys.has(key));
    return {
        kind: 'project',
        title: textOf(plan.project.ProjectName),
        lines,
        needs,
        ...(locked.length ? { locked, lockedWhy: Object.fromEntries(locked.map((key) => [key, plan.lockedWhy?.[key]])) } : {}),
    };
};

export const keptLists = (picks) => (picks && Array.isArray(picks.lists) ? picks.lists.length : null);
