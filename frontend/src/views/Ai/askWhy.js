export const KIND_KEYS = Object.freeze({
    task: "Ask.kind_task",
    page: "Ask.kind_page",
    comment: "Ask.kind_comment",
    transcript: "Ask.kind_transcript"
});

export const REASON_KEYS = Object.freeze({
    project_member: "Ask.reason_project_member",
    private_owner: "Ask.reason_private_owner",
    company_page: "Ask.reason_company_page",
    call_participant: "Ask.reason_call_participant",
    owner_admin: "Ask.reason_owner_admin"
});

const REASON_ICONS = Object.freeze({
    project_member: "members",
    private_owner: "lock",
    company_page: "globe",
    call_participant: "mic",
    owner_admin: "shield"
});

const MESSAGE_KEYS = Object.freeze({
    question_required: "Ask.error_question_required",
    unauthenticated: "Ask.error_unauthenticated",
    no_match: "Ask.empty_no_match",
    scope: "Ask.note_scope"
});

export const messageKey = (code) => (Object.prototype.hasOwnProperty.call(MESSAGE_KEYS, code) ? MESSAGE_KEYS[code] : "");

/* A private page and a call transcript are narrower than any role, so an owner or
 * admin sees them for the same reason everyone else does; only project passages
 * are open to them by role. */
export const visibilityReason = (permission, privileged) => {
    if (!permission || typeof permission !== "object") return "";
    switch (permission.visibility) {
        case "private": return "private_owner";
        case "company": return "company_page";
        case "participants": return "call_participant";
        case "project": return privileged ? "owner_admin" : "project_member";
        default: return "";
    }
};

export const hasPermissionDetail = (sources) => (sources || []).some((source) => Boolean(visibilityReason(source && source.permission, false)));

/* Tasks open in the task overlay the app hosts on every route; comments and call
 * transcripts have no page of their own to link to. */
export const sourceLink = (source, companyId) => {
    if (!source || !source.id) return null;
    if (source.kind === "task") return { query: { task: String(source.id) } };
    if (source.kind === "page") return { name: "PageEditor", params: { cid: companyId, pageId: String(source.id) } };
    return null;
};

export const whyRows = (sources, { cited = [], privileged = false, companyId = "" } = {}) => {
    const citedRefs = new Set(cited);
    return (sources || []).filter(Boolean).map((source, index) => {
        const reason = visibilityReason(source.permission, privileged);
        return {
            key: `${source.ref || source.id || ""}:${index}`,
            ref: source.ref || "",
            title: source.title || "",
            project: source.project || "",
            excerpt: source.detail || "",
            updatedAt: source.updatedAt || null,
            kindKey: KIND_KEYS[source.kind] || "",
            to: sourceLink(source, companyId),
            cited: Boolean(source.ref) && citedRefs.has(source.ref),
            reasonKey: reason ? REASON_KEYS[reason] : "",
            reasonIcon: reason ? REASON_ICONS[reason] : ""
        };
    });
};
