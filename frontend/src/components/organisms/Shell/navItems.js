import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useCustomComposable } from "@/composable";

const PROJECT_ROUTE_PREFIX = "Project";

export function useNavItems(companyId) {
    const route = useRoute();
    const router = useRouter();
    const { getters } = useStore();
    const { checkPermission } = useCustomComposable();

    const rules = computed(() => getters["settings/rules"]);
    const ready = computed(() => !!(rules.value && Object.keys(rules.value).length));
    const companyUser = computed(() => getters["settings/companyUserDetail"] || {});
    const isOwnerOrAdmin = computed(() => [1, 2].includes(companyUser.value?.roleType));

    const allowed = (key) => ready.value && checkPermission(key) !== null && checkPermission(key) !== undefined;
    const exists = (name) => router.hasRoute(name);
    const to = (name, extra = {}) => ({ name, params: { cid: companyId.value, ...(extra.params || {}) }, query: extra.query });

    const timesheetRoute = computed(() => {
        if (allowed("sheet_settings.user_timesheet")) return "User Timesheet";
        if (allowed("sheet_settings.project_timesheet")) return "project Timesheet";
        if (allowed("sheet_settings.workload_timesheet")) return "Workload Timesheet";
        if (allowed("sheet_settings.tracker_timesheet")) return "Tracker Timesheet";
        return null;
    });

    const rail = computed(() => [
        { key: "home", label: "Shell.home", icon: "home", to: to("Home"), match: (r) => r.name === "Home" || r.name === "PersonalList", show: true },
        { key: "projects", label: "Header.Projects", icon: "projects", to: to("Projects"), match: (r) => String(r.name || "").startsWith(PROJECT_ROUTE_PREFIX), show: allowed("project.project_list") },
        { key: "inbox", label: "Inbox.title", icon: "inbox", to: to("inbox"), match: (r) => r.name === "inbox", show: ready.value },
        { key: "planner", label: "Shell.planner", icon: "planner", to: to("Planner"), match: (r) => r.name === "Planner", show: exists("Planner") },
        { key: "chat", label: "Shell.chat", icon: "chat", to: to("chats"), match: (r) => String(r.name || "").startsWith("chat"), show: allowed("chat") },
        { key: "ai", label: "Shell.ai", icon: "ai", to: to("AiHub"), match: (r) => String(r.name || "").startsWith("Ai"), show: exists("AiHub") },
        { key: "docs", label: "Shell.docs", icon: "docs", to: to("Pages"), match: (r) => r.name === "Pages", show: ready.value },
        { key: "dash", label: "Shell.dash", icon: "dash", to: to("Dashboards"), match: (r) => r.name === "Dashboards", show: exists("Dashboards") && allowed("project.project_list") },
        { key: "time", label: "Shell.time", icon: "time", to: timesheetRoute.value ? to(timesheetRoute.value) : null, match: (r) => String(r.name || "").includes("Timesheet"), show: !!timesheetRoute.value }
    ].filter((i) => i.show));

    const more = computed(() => {
        const groups = [
            {
                label: "Shell.work",
                items: [
                    { key: "portfolio", label: "Header.Portfolio", icon: "portfolio", to: to("Portfolio"), match: (r) => r.name === "Portfolio", show: ready.value },
                    { key: "automations", label: "Automations.title", icon: "automations", to: to("Automations"), match: (r) => r.name === "Automations", show: ready.value && exists("Automations") },
                    { key: "integrations", label: "Header.Integrations", icon: "integrations", to: to("IntegrationsHub"), match: (r) => r.name === "IntegrationsHub", show: ready.value && exists("IntegrationsHub") },
                    { key: "connections", label: "ParityV2.nav_connections", icon: "key", to: to("Connections"), match: (r) => r.name === "Connections", show: ready.value && exists("Connections") },
                    { key: "externalData", label: "ProvenanceV2.nav_external_data", icon: "globe", to: to("ExternalData"), match: (r) => r.name === "ExternalData", show: ready.value && exists("ExternalData") }
                ]
            },
            {
                label: "Header.Reports",
                items: [
                    { key: "milestone", label: "Header.Milestone_Report", icon: "reports", to: to("Milestone Report"), match: (r) => r.name === "Milestone Report", show: allowed("sheet_settings.milestone_report") },
                    { key: "variance", label: "Header.Variance_Report", icon: "reports", to: to("VarianceReport"), match: (r) => r.name === "VarianceReport", show: ready.value && exists("VarianceReport") },
                    { key: "custom", label: "Header.Custom_Report", icon: "reports", to: to("CustomReport"), match: (r) => r.name === "CustomReport", show: ready.value && exists("CustomReport") },
                    { key: "capacity", label: "Header.Capacity_Planning", icon: "reports", to: to("CapacityPlanning"), match: (r) => r.name === "CapacityPlanning", show: ready.value && exists("CapacityPlanning") }
                ]
            },
            {
                label: "Shell.tools",
                items: [
                    { key: "notepad", label: "Notepad.title", icon: "notepad", panel: "notepad", show: ready.value },
                    { key: "clips", label: "Clips.title", icon: "clips", panel: "clips", show: ready.value },
                    { key: "reminders", label: "Reminders.header_tooltip", icon: "reminder", panel: "reminders", show: ready.value },
                    { key: "talk", label: "TalkToText.title", icon: "mic", panel: "talkToText", show: ready.value },
                    { key: "tour", label: "Header.take_tour", icon: "tour", panel: "tour", show: ready.value }
                ]
            },
            {
                label: "Shell.workspace",
                items: [
                    { key: "settings", label: "settingslider.Settings", icon: "settings", to: to("Setting"), match: (r) => r.path.includes("/settings"), show: ready.value },
                    { key: "trash", label: "TrashV2.title", icon: "trash", to: to("Trash"), match: (r) => r.name === "Trash", show: ready.value && exists("Trash") },
                    { key: "members", label: "settingslider.Members", icon: "members", to: to("Members"), match: (r) => r.name === "Members", show: ready.value && isOwnerOrAdmin.value },
                    { key: "audit", label: "Audit.title", icon: "audit", to: to("AuditLog"), match: (r) => r.name === "AuditLog", show: ready.value && isOwnerOrAdmin.value },
                    { key: "changelog", label: "Changelog.view_whats_new", icon: "changelog", to: to("Changelog"), newTab: true, show: true },
                    { key: "help", label: "Shell.help", icon: "help", href: getters["brandSettingTab/brandSettings"]?.helpLink || "", show: !!getters["brandSettingTab/brandSettings"]?.helpLink }
                ]
            }
        ];
        return groups.map((g) => ({ ...g, items: g.items.filter((i) => i.show) })).filter((g) => g.items.length);
    });

    const isActive = (item) => !!(item.match && item.match(route));
    const moreActive = computed(() => more.value.some((g) => g.items.some(isActive)));

    return { rail, more, isActive, moreActive, ready, companyUser, isOwnerOrAdmin };
}
