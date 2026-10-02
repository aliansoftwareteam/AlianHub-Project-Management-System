// The lines of a waiting automation (Modules/Agents/automationPreview.js). The rule's own words come from the
// server, as the Automations page shows them; the labels and what frames them are worded here.

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');
const countOf = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const worded = (labelKey) => (t, line) => (textOf(line.text) ? { label: t(labelKey), text: textOf(line.text) } : null);

export const AUTOMATION_HEADING = Object.freeze({ kind: 'AutomationPreview.heading', wants: 'AutomationPreview.wants' });

export const AUTOMATION_LINE_KINDS = {
    ruleStart: worded('AutomationPreview.line_start'),
    rule: worded('AutomationPreview.line_rule'),
    ruleStep: (t, line) => (textOf(line.text) ? { label: t('AutomationPreview.line_step', { n: countOf(line.n) }), text: textOf(line.text) } : null),
    ruleReach: (t) => ({ label: t('AutomationPreview.line_reach'), text: t('AutomationPreview.reach') }),
    ruleState: (t, line) => ({ label: t('AutomationPreview.line_state'), text: t(line.on === true ? 'AutomationPreview.state_on' : 'AutomationPreview.state_off') }),
    ruleRuns: (t, line) => {
        const count = countOf(line.count);
        return { label: t('AutomationPreview.line_runs', { days: countOf(line.days) }), text: count ? t('AutomationPreview.runs', { n: count }, count) : t('AutomationPreview.runs_none') };
    },
    ruleExamples: (t, line) => {
        const tasks = (Array.isArray(line.tasks) ? line.tasks : []).map(textOf).filter(Boolean);
        return tasks.length ? { label: t('AutomationPreview.line_examples'), text: tasks.join(', ') } : null;
    },
    ruleProblem: worded('AutomationPreview.line_problem'),
};
