export const SAMPLE_PROJECT_NAME = "Welcome to AlianHub";

export const FOCUS_KEYS = ["software", "design", "marketing", "agency", "operations", "support", "other"];

export const BLANK_TEMPLATE_ID = "blank";

/* Mirrors Modules/createProject/blankTemplate.js — the server owns the real one. */
export const blankTemplate = (t) => ({
    _id: BLANK_TEMPLATE_ID,
    TemplateName: t("AuthV2.blank"),
    Description: t("AuthV2.blank_desc"),
    focus: "other",
    useTemplateProj: "category",
    taskStatusData: [
        { name: "To Do", type: "default_active" },
        { name: "In Progress", type: "active" },
        { name: "Done", type: "close" }
    ],
    TemplateRequiredComponent: [{ keyName: "ProjectListView", setAsDefault: true }],
    sampleTaskCount: 0,
    sampleTaskNames: [],
    customFiedlsValue: []
});

const GLYPHS = {
    software: { icon: "automations", tone: "brand" },
    design: { icon: "docs", tone: "warn" },
    marketing: { icon: "portfolio", tone: "ok" },
    agency: { icon: "members", tone: "brand" },
    operations: { icon: "settings", tone: "neutral" },
    support: { icon: "inbox", tone: "danger" },
    other: { icon: "projects", tone: "neutral" }
};

export const templateGlyph = (template) => GLYPHS[template?.focus] || GLYPHS.other;

const PROJECT_COLORS = ["#2F3990", "#2f9e7e", "#d98324", "#6b5ce7", "#0EA5E9", "#EC4899", "#14B8A6", "#F97316"];

export const colorForName = (name) => {
    const hash = Array.from(String(name || "")).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
    return PROJECT_COLORS[hash % PROJECT_COLORS.length];
};

export const keyFromName = (name) => {
    const words = String(name || "").trim().match(/\b(\w)/g) || [];
    return words.join("").toUpperCase().slice(0, 6);
};

export const statusTone = (status, index) => {
    if (status.type === "close" || status.type === "done") return "ok";
    if (status.type === "default_active" || index === 0) return "neutral";
    return index % 2 === 1 ? "brand" : "warn";
};
