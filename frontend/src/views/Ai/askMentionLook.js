export const MENTION_KIND_LOOK = Object.freeze({
    project: { icon: "projects", group: "Ask.group_projects", label: "Ask.kind_project" },
    list: { icon: "layers", group: "Ask.group_lists", label: "Ask.kind_list" },
    task: { icon: "checkSquare", group: "Ask.group_tasks", label: "Ask.kind_task" },
    page: { icon: "docs", group: "Ask.group_docs", label: "Ask.kind_page" },
    person: { icon: "user", group: "Ask.group_people", label: "Ask.kind_person" }
});

export const mentionIcon = (kind) => (MENTION_KIND_LOOK[kind] || {}).icon || "at";
