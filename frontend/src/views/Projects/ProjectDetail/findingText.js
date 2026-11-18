const waits = (finding) => finding.rule === "slipping" && Boolean(finding.facts?.blockerKey);

const kindOf = (finding) => {
    if (finding.rule === "triage") return `triage_${(finding.facts || {}).kind}`;
    return waits(finding) ? "slipping_waits" : finding.rule;
};

const taskOf = (facts) => facts.taskKey || facts.taskName || "";

/* The sentences a finding's reason is made of, each from the facts the rule stored. */
export const findingReasons = (t, finding) => {
    const facts = finding.facts || {};
    const late = Number(facts.daysLate) > 0 ? [t("ProjectManager.reason_slipping", { n: facts.daysLate }, facts.daysLate)] : [];
    switch (kindOf(finding)) {
        case "slipping": return late;
        case "slipping_waits": return [...late, t("ProjectManager.reason_slipping_waits", { blocker: facts.blockerKey, n: facts.days }, facts.days)];
        case "blocked": return [t("ProjectManager.reason_blocked", { blocker: facts.blockerKey, n: facts.quietDays }, facts.quietDays)];
        case "overloaded": return [t("ProjectManager.reason_overloaded", { planned: facts.plannedHours, capacity: facts.capacityHours })];
        case "stale": return [t("ProjectManager.reason_stale", { n: facts.quietDays }, facts.quietDays)];
        case "untriaged": return [t("ProjectManager.reason_untriaged", { origin: t(facts.origin === "form" ? "ProjectManager.origin_form" : "ProjectManager.origin_email") })];
        case "no_owner": return [t("ProjectManager.reason_no_owner")];
        case "no_estimate": return [t("ProjectManager.reason_no_estimate")];
        case "handed_over": return [t("ProjectManager.reason_handed_over")];
        case "triage_priority": return [t("ProjectManager.reason_triage_priority", { priority: facts.priority }), ...(facts.reason ? [facts.reason] : [])];
        case "triage_estimate": return [t("ProjectManager.reason_triage_estimate", { n: facts.minutes }, facts.minutes), ...(facts.reason ? [facts.reason] : [])];
        case "triage_duplicate": return [t("ProjectManager.reason_triage_duplicate", { other: facts.duplicateKey || facts.duplicateName }), ...(facts.reason ? [facts.reason] : [])];
        default: return [];
    }
};

export const findingOffer = (t, finding) => t(`ProjectManager.offer_${kindOf(finding)}`, { task: taskOf(finding.facts || {}) });

/* What a ready change does, worded to follow "wants to" in the approval queue; empty for a finding that has none. */
export const findingFix = (t, finding) => {
    const facts = finding.facts || {};
    switch (kindOf(finding)) {
        case "slipping_waits": return t("ProjectManager.fix_slipping_waits", { task: taskOf(facts), n: facts.days }, facts.days);
        case "blocked": return t("ProjectManager.fix_blocked", { blocker: facts.blockerKey });
        case "stale": return t("ProjectManager.fix_stale", { task: taskOf(facts) });
        case "triage_priority": return t("ProjectManager.fix_triage_priority", { task: taskOf(facts), priority: facts.priority });
        case "triage_estimate": return t("ProjectManager.fix_triage_estimate", { task: taskOf(facts), n: facts.minutes }, facts.minutes);
        case "triage_duplicate": return t("ProjectManager.fix_triage_duplicate", { task: taskOf(facts), other: facts.duplicateKey || facts.duplicateName });
        default: return "";
    }
};
