import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useCustomComposable } from "@/composable";
import { isAiSectionRoute } from "@/router/ai/section";
import { CONNECT_AI_ROUTE } from "@/router/ai/connect";
import { aiReachable, canUseAi } from "@/composable/aiAvailability";
import { isOwnerOrAdmin as isOwnerOrAdminRole } from "@/utils/roles";
import { canApprove } from "@/views/Approvals/approvalAccess";
import { keepOnRail, shellState } from "./shellState";
import { SIMPLE_PLACES } from "./navMode";

const PROJECT_ROUTE_PREFIX = "Project";

export function useNavItems(companyId) {
    const route = useRoute();
    const router = useRouter();
    const { getters } = useStore();
    const { checkPermission } = useCustomComposable();

    const rules = computed(() => getters["settings/rules"]);
    const ready = computed(() => !!(rules.value && Object.keys(rules.value).length));
    const companyUser = computed(() => getters["settings/companyUserDetail"] || {});
    const isOwnerOrAdmin = computed(() => isOwnerOrAdminRole(companyUser.value?.roleType));

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

    const places = computed(() => [
        { key: "home", label: "Shell.home", icon: "home", to: to("Home"), match: (r) => r.name === "Home" || r.name === "PersonalList", show: true },
        { key: "everything", label: "Shell.everything", icon: "layers", to: to("Everything"), match: (r) => r.name === "Everything", show: ready.value && exists("Everything") },
        { key: "goals", label: "Shell.goals", icon: "target", to: to("Goals"), match: (r) => r.name === "Goals" || r.name === "Goal", show: ready.value && exists("Goals") },
        { key: "projects", label: "Header.Projects", icon: "projects", to: to("Projects"), match: (r) => String(r.name || "").startsWith(PROJECT_ROUTE_PREFIX), show: allowed("project.project_list") },
        { key: "inbox", label: "Inbox.title", icon: "inbox", to: to("inbox"), match: (r) => r.name === "inbox", show: ready.value },
        { key: "planner", label: "Shell.planner", icon: "planner", to: to("Planner"), match: (r) => r.name === "Planner", show: exists("Planner") },
        { key: "chat", label: "Shell.chat", icon: "chat", to: to("chats"), match: (r) => String(r.name || "").startsWith("chat"), show: allowed("chat") },
        { key: "ai", label: "Shell.ai", icon: "ai", to: to("AiAsk"), match: (r) => isAiSectionRoute(r.name), show: exists("AiAsk") && aiReachable.value },
        { key: "docs", label: "Shell.docs", icon: "docs", to: to("Pages"), match: (r) => r.name === "Pages", show: ready.value },
        { key: "dash", label: "Shell.dash", icon: "dash", to: to("Dashboards"), match: (r) => r.name === "Dashboards", show: exists("Dashboards") && allowed("project.project_list") },
        { key: "time", label: "Shell.time", icon: "time", to: timesheetRoute.value ? to(timesheetRoute.value) : null, match: (r) => String(r.name || "").includes("Timesheet"), show: !!timesheetRoute.value }
    ].filter((i) => i.show));

    const menu = computed(() => {
        const groups = [
            {
                label: "Shell.work",
                items: [
                    { key: "portfolio", label: "Header.Portfolio", icon: "portfolio", to: to("Portfolio"), match: (r) => r.name === "Portfolio", show: ready.value },
                    { key: "automations", label: "Automations.title", icon: "automations", to: to("Automations"), match: (r) => r.name === "Automations", show: ready.value && exists("Automations") },
                    { key: "approvals", label: "Time.approvals", icon: "checkSquare", to: to("Approvals"), match: (r) => r.name === "Approvals", show: ready.value && exists("Approvals") && canApprove(companyUser.value) },
                    { key: "integrations", label: "Header.Integrations", icon: "integrations", to: to("IntegrationsHub"), match: (r) => r.name === "IntegrationsHub", show: ready.value && exists("IntegrationsHub") },
                    { key: "connections", label: "Parity.nav_connections", icon: "key", to: to("Connections"), match: (r) => r.name === "Connections", show: ready.value && exists("Connections") },
                    { key: "externalData", label: "Provenance.nav_external_data", icon: "globe", to: to("ExternalData"), match: (r) => r.name === "ExternalData", show: ready.value && exists("ExternalData") }
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
                    { key: "talk", label: "TalkToText.title", icon: "mic", panel: "talkToText", show: ready.value && canUseAi() },
                    { key: "tour", label: "Home.take_tour", icon: "tour", panel: "tourAsked", show: ready.value }
                ]
            },
            {
                label: "Shell.workspace",
                items: [
                    { key: "settings", label: "settingslider.Settings", icon: "settings", to: to("Setting"), match: (r) => r.path.includes("/settings"), show: ready.value },
                    { key: "trash", label: "Trash.title", icon: "trash", to: to("Trash"), match: (r) => r.name === "Trash", show: ready.value && exists("Trash") },
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

    const simple = computed(() => shellState.nav?.mode === "simple");
    const inSimple = (item) => {
        if (item.key === "everything") return { ...item, label: "Shell.my_work", to: to("Everything", { query: { mine: "1" } }) };
        // Where the built-in AI cannot answer this person (no model on the server, say), Ask leads to connecting their own.
        if (item.key === "ai") return { ...item, label: "Shell.ask", to: !canUseAi() && exists(CONNECT_AI_ROUTE) ? to(CONNECT_AI_ROUTE) : item.to };
        return item;
    };
    const rail = computed(() => {
        if (!simple.value) return places.value;
        const kept = shellState.nav.pinned || [];
        const five = SIMPLE_PLACES.map((key) => places.value.find((item) => item.key === key)).filter(Boolean).map(inSimple);
        return [...five, ...places.value.filter((item) => !SIMPLE_PLACES.includes(item.key) && kept.includes(item.key))];
    });
    const more = computed(() => {
        const tucked = simple.value ? places.value.filter((item) => !rail.value.some((shown) => shown.key === item.key)) : [];
        return tucked.length ? [{ label: "Shell.more_places", items: tucked }, ...menu.value] : menu.value;
    });
    watch(() => (simple.value ? places.value.find(isActive)?.key : ""), (key) => { if (key) keepOnRail(key); }, { immediate: true });
    // Connections sits in both the AI section and the More menu; a rail tile that already
    // claims the route wins, so the two never light up together.
    const moreActive = computed(() => !rail.value.some(isActive) && more.value.some((g) => g.items.some(isActive)));

    return { rail, more, isActive, moreActive, ready, companyUser, isOwnerOrAdmin, simple };
}
