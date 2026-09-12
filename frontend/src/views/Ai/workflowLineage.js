// The lineage of a workflow run: who handed off to whom, what travelled along
// each edge and who is accountable for each step.
//
// Nothing new is fetched for this. A step row already carries what it depends
// on, the `$<stepId>.<field>` references its configuration reads, the output the
// producer settled with, the agent run behind an agent_run step and the approver
// on an approval — so the chain is a reading of the run, not a second record of
// it. The reference grammar is the one Modules/Workflows/typed.js enforces.

import { agentRunIdOf, groupSteps, stepStatusOf, stepTypeOf } from "./workflowRun";

const REF = /^\$([0-9a-zA-Z_-]+)(?:\.([0-9a-zA-Z_.-]+))?$/;

const MAX_DEPTH = 12;

export const refsIn = (node, found = [], depth = 0) => {
    if (depth > MAX_DEPTH || node === null || node === undefined) return found;
    if (typeof node === "string") {
        const [, stepId, field] = node.match(REF) || [];
        if (stepId) found.push({ stepId, field: field ? String(field).split(".")[0] : null, raw: node });
        return found;
    }
    if (Array.isArray(node)) { node.forEach((child) => refsIn(child, found, depth + 1)); return found; }
    if (typeof node === "object") { Object.values(node).forEach((child) => refsIn(child, found, depth + 1)); return found; }
    return found;
};

export const VALUE_MAX = 60;

/* What travelled, in a line. A typed result can be anything the contract allows,
 * and a lineage that printed a whole findings array would be the raw dump this
 * view exists instead of. */
export const summariseValue = (value) => {
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) return `[${value.length}]`;
    if (typeof value === "object") return `{${Object.keys(value).slice(0, 3).join(", ")}}`;
    const text = String(value);
    return text.length > VALUE_MAX ? `${text.slice(0, VALUE_MAX - 1)}…` : text;
};

/* Every edge into this step: the steps it waits for, and the fields it reads
 * from them. A dependency that hands over nothing typed is still an edge — it is
 * the handoff itself — and a reference to a step that is not in the run is not,
 * because there is nobody at the other end of it. */
export const edgesOf = (step, byId) => {
    const edges = new Map();
    const add = (fromId, field) => {
        const producer = byId.get(String(fromId));
        if (!producer) return;
        const key = `${fromId}:${field || ""}`;
        if (edges.has(key)) return;
        edges.set(key, {
            from: String(fromId),
            fromType: stepTypeOf(producer),
            fromStatus: stepStatusOf(producer),
            field: field || null,
            value: field ? summariseValue((producer.output || {})[field]) : "",
            produced: field ? (producer.output || {})[field] !== undefined : true
        });
    };
    (step?.dependsOn || []).forEach((fromId) => add(fromId, null));
    refsIn(step?.config || {}).forEach((ref) => add(ref.stepId, ref.field));
    return [...edges.values()];
};

/* Who answers for this step.
 *
 * An approval is answered by a person and an agent run is done by an agent, and
 * those are the two the run itself records. Everything else is the run's own
 * doing, so the accountable person is whoever started it. */
export const accountableOf = (step, run) => {
    const type = stepTypeOf(step);
    const output = step?.output || {};
    const config = step?.config || {};
    if (type === "human_approval") {
        const userId = output.decidedBy || config.ownerUserId || null;
        return {
            kind: "person",
            userId: userId && userId !== "system" ? String(userId) : null,
            system: userId === "system",
            role: config.ownerRole || null,
            decided: Boolean(output.decidedBy),
            decision: output.decision || null,
            escalated: output.escalated === true
        };
    }
    if (type === "agent_run") {
        return {
            kind: "agent",
            agentId: config.agentId ? String(config.agentId) : null,
            agentRunId: agentRunIdOf(step),
            userId: run?.startedBy ? String(run.startedBy) : null
        };
    }
    if (type === "automation_rule") {
        return { kind: "automation", ruleId: run?.ruleId ? String(run.ruleId) : null, ruleName: run?.ruleName || "" };
    }
    return { kind: "person", userId: run?.startedBy ? String(run.startedBy) : null, forRun: true };
};

/* The chain, in the order the run executes it.
 *
 * A fan-out is one link with a tally rather than one per child, exactly as the
 * run view draws it — `groupSteps` is the same grouping, so a fan of fifty is
 * still one row until somebody asks for the rest. */
export const chainOf = (steps = [], run = null, { expanded = [] } = {}) => {
    const byId = new Map((steps || []).map((step) => [String(step.stepId), step]));
    return groupSteps(steps, { expanded }).map((node) => ({
        ...node,
        edges: edgesOf(node.step, byId),
        accountable: accountableOf(node.step, run),
        children: node.children,
        shown: node.shown.map((child) => ({
            step: child,
            edges: edgesOf(child, byId),
            accountable: accountableOf(child, run)
        }))
    }));
};

/* The steps nothing hands to: where the run begins. Useful on its own, because a
 * chain with several roots is several conversations rather than one. */
export const rootsOf = (steps = []) => (steps || [])
    .filter((step) => !step.parentStepId && !(step.dependsOn || []).length)
    .map((step) => String(step.stepId));
