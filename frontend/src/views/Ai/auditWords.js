import { labelSlug, skillLabel } from "./plainLabels";
import { agentActionLabel } from "./agentActionLabels";
import { declineReasonText } from "./episodeText";

/* The server's keys for these are in Modules/Audit/eventWords.js; tests/conventions/audit-event-labels.test.js
   keeps the two lists the same. */
const AGENT_ROWS = Object.freeze(["agent.action", "agent.action_refused", "agent.action_undone"]);
const PROPOSAL_DECIDED = "agent.proposal_decided";
const DECISIONS = Object.freeze(["approved", "declined", "undone", "failed"]);
const PERSON = "member";

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const BARE_CODE = /^[a-z][a-z0-9_]*$/;
const CODED = /^([a-z][a-z0-9_]*): ?([\s\S]*)$/;
const SPEND = /the next call is estimated at \$([\d.]+) \(\d+ tokens\) but the \S+ cap of \$([\d.]+) has \$([\d.]+) left/;
const STEP_CREDENTIAL = /^step credential refused: /;
const EXTERNAL_STEP = /^external agent step refused: ([a-z_]+)/;
const APPROVED_PROPOSAL = /^approved proposal [a-f0-9]{24} by (\S+)$/i;
const STANDING = /^([\s\S]*) \(standing approval [a-f0-9]{24}, made by (\S+)\)$/i;
const SKILL_FINDING = /^(\S+) finding$/;
/* Rows written before the server's sentences were reworded still hold "Agents cannot perform ..." and "the task is
   not one ...", so both wordings are read. A list's sentence names its project too, so the list is asked first. */
const AGENTS_CANNOT = /^Agents cannot perform ([\s\S]+)$/;
const STATUS_SET = /^task\.status\.set\("([^"]*)"\)$/;
const CANNOT_SET = /^You cannot set a task to "([^"]*)"\./;
const AGENT_REFUSALS = Object.freeze([
    ["agents_never", /^An agent is never allowed to do this \(/],
    ["agents_cannot", /^(?:An agent is not allowed to do this|That action is not available to agents) \(/],
    ["agents_not_in_skills", / is not switched on for this connection\./],
    ["agents_must_propose", / so it has to be sent as a proposal\.$/],
    ["agents_cannot_fields", / cannot change [\s\S]+\. Leave that out\.$/],
]);
const NOT_VISIBLE_KINDS = Object.freeze([
    ["thread", /comment thread|open its comments/],
    ["list", /\b(?:the|that) list\b/],
    ["task", /\b(?:the|that) task\b/],
    ["project", /\b(?:the|that) project\b|^project /],
]);

const worded = (t, namespace, key) => {
    const path = `${namespace}.${labelSlug(key)}`;
    const words = t(path);
    return words && words !== path ? words : "";
};

const money = (amount) => Number(amount).toFixed(2);

export const actionWords = (t, key) => agentActionLabel(t, key) || worded(t, "AuditActions", key);

const decisionOf = (row) => String((row.meta && row.meta.decision) || "").split(":")[0].trim();

const happened = (t, row) => {
    if (row.action === PROPOSAL_DECIDED && DECISIONS.includes(decisionOf(row))) return t(`Audit.proposal_${decisionOf(row)}`);
    return worded(t, "AuditEvents", row.action) || t("Audit.event_unnamed");
};

/* On an agent's row the words are what it did or tried; on any other, what happened, and what to when the row says. */
export const eventWords = (t, row) => {
    const tried = String((row.meta && row.meta.action) || "");
    if (!AGENT_ROWS.includes(row.action)) {
        const what = tried ? actionWords(t, tried) : "";
        return what ? t("Audit.event_with_action", { event: happened(t, row), action: what }) : happened(t, row);
    }
    const what = actionWords(t, tried) || t("Audit.event_unnamed");
    return row.action === "agent.action_undone" ? t("Audit.event_undid", { action: what }) : what;
};

export const eventKey = (row) => (row.meta && row.meta.action) || row.action;

const permissionName = (t, te, key) => {
    const rule = String(key).split(".").pop();
    return te(`SecurityAndPermission.${rule}`) ? t(`SecurityAndPermission.${rule}`) : key;
};

/* The name of what the row is about. An id with no name the reader can be given is left to the details. */
export const entityWords = (t, te, row, personName = () => "") => {
    const id = String(row.entityId || "");
    const stored = String(row.entityName || "");
    if (row.entityType === "permission") return permissionName(t, te, stored || id);
    if (stored && !OBJECT_ID.test(stored)) return stored;
    if (row.entityLabel) return String(row.entityLabel);
    if (row.entityType === PERSON && personName(id)) return personName(id);
    return OBJECT_ID.test(id) ? "" : id;
};

const notVisible = (t, detail) => {
    const kind = (NOT_VISIBLE_KINDS.find(([, pattern]) => pattern.test(detail)) || [""])[0];
    return t(kind ? `AuditReasons.not_visible_${kind}` : "AuditReasons.not_visible");
};

const spendCap = (t, detail) => {
    const parts = SPEND.exec(detail);
    return parts ? t("AuditReasons.spend_cap_exceeded_detail", { cost: money(parts[1]), limit: money(parts[2]), left: money(parts[3]) }) : t("AuditReasons.spend_cap_exceeded");
};

const agentsCannot = (t, what) => {
    if (what.endsWith("(never_listed)")) return t("AuditReasons.agents_never");
    if (what.endsWith("(not in this agent's skills)")) return t("AuditReasons.agents_not_in_skills");
    if (what.endsWith("it must be proposed")) return t("AuditReasons.agents_must_propose");
    const status = STATUS_SET.exec(what);
    if (status) return t("AuditReasons.agents_cannot_status", { status: status[1] });
    return / on /.test(what) ? t("AuditReasons.agents_cannot_fields") : t("AuditReasons.agents_cannot");
};

const CODED_REASONS = Object.freeze({
    not_visible: notVisible,
    spend_cap_exceeded: spendCap,
    budget_unavailable: (t) => t("AuditReasons.budget_unavailable"),
    permission_denied: (t) => t("AuditReasons.permission_denied"),
});

/* A reason the server wrote as a code, or with one in front, in a sentence. Words a person or an agent typed
   are returned as they are. `personName(id)` names a person the reader can already see. */
export const plainReason = (t, te, reason, personName = () => "") => {
    const text = String(reason || "").trim();
    if (!text) return "";
    if (BARE_CODE.test(text)) return te(`AuditReasons.${text}`) ? t(`AuditReasons.${text}`) : text;
    const approved = APPROVED_PROPOSAL.exec(text);
    if (approved) return personName(approved[1]) ? t("AuditReasons.approved_by", { person: personName(approved[1]) }) : t("AuditReasons.approved_by_someone");
    const standing = STANDING.exec(text);
    if (standing) {
        const always = personName(standing[2]) ? t("AuditReasons.always_by", { person: personName(standing[2]) }) : t("AuditReasons.always");
        const said = actionWords(t, standing[1]) ? "" : plainReason(t, te, standing[1], personName);
        return said ? t("AuditReasons.said_and", { said, also: always }) : always;
    }
    if (text === "via REST") return t("AuditReasons.via_rest");
    const finding = SKILL_FINDING.exec(text);
    if (finding) return t("AuditReasons.skill_finding", { skill: skillLabel(t, finding[1]) });
    if (STEP_CREDENTIAL.test(text)) return t("AuditReasons.step_credential_refused");
    const external = EXTERNAL_STEP.exec(text);
    if (external) return te(`AuditReasons.external_${external[1]}`) ? t(`AuditReasons.external_${external[1]}`) : t("AuditReasons.external_refused");
    const cannot = AGENTS_CANNOT.exec(text);
    if (cannot) return agentsCannot(t, cannot[1]);
    const cannotSet = CANNOT_SET.exec(text);
    if (cannotSet) return t("AuditReasons.agents_cannot_status", { status: cannotSet[1] });
    const refusal = AGENT_REFUSALS.find(([, pattern]) => pattern.test(text));
    if (refusal) return t(`AuditReasons.${refusal[0]}`);
    const coded = CODED.exec(text);
    if (coded && CODED_REASONS[coded[1]]) return CODED_REASONS[coded[1]](t, coded[2]);
    return text;
};

const decisionReason = (t, row) => {
    const [, said = ""] = /^[a-z]+: ?([\s\S]*)$/.exec(String((row.meta && row.meta.decision) || "")) || [];
    return decisionOf(row) === "declined" ? declineReasonText(said, t) : said;
};

export const rawReason = (row) => String((row.meta && row.meta.reason) || "");

export const reasonWords = (t, te, row, personName) => {
    if (row.action === PROPOSAL_DECIDED && !rawReason(row)) return decisionReason(t, row);
    return plainReason(t, te, rawReason(row), personName);
};

const SEARCH_KEYS_MAX = 25;
const SEARCHED = Object.freeze({ qEvents: ["AuditEvents"], qActions: ["AuditActions", "AgentActions"], qReasons: ["AuditReasons"] });

/* The keys whose words, in the reader's language, hold what was typed. The server matches rows by them
   (Modules/Audit/eventWords.js), since a row stores its key and not its words. `messagesOf(namespace)` answers
   that namespace's words by key. */
export const searchKeys = (messagesOf, typed) => {
    const text = String(typed || "").trim().toLowerCase();
    if (!text) return {};
    const holding = (namespace) => Object.entries(messagesOf(namespace) || {})
        .filter(([, words]) => typeof words === "string" && words.toLowerCase().includes(text))
        .map(([key]) => key);
    return Object.fromEntries(Object.entries(SEARCHED)
        .map(([name, namespaces]) => [name, namespaces.flatMap(holding).slice(0, SEARCH_KEYS_MAX).join(",")])
        .filter(([, keys]) => keys));
};

/* What the row holds as it was written, for whoever needs the keys and the ids. */
export const detailLines = (t, row, shownReason) => {
    const tried = String((row.meta && row.meta.action) || "");
    const lines = [{ label: t("Audit.detail_key"), value: tried ? `${row.action} · ${tried}` : String(row.action || "") }];
    if (row.entityId) lines.push({ label: t("Audit.detail_on"), value: [row.entityType, row.entityId].filter(Boolean).join(" ") });
    if (rawReason(row) && rawReason(row) !== shownReason) lines.push({ label: t("Audit.detail_reason"), value: rawReason(row) });
    return lines;
};
