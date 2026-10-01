import { computed, inject, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { apiRequest } from "@/services";
import { useGetterFunctions } from "@/composable";
import { FIRST_RUN_STEPS, isFirstRunStepDone } from "@/composable/firstRunProgress";
import { onboardingRecord, saveOnboarding } from "@/composable/onboardingState";
import { AI_STATE, aiAvailability } from "@/composable/aiAvailability";
import { CONNECT_STATE, aiConnection, connectStateFor, loadAiConnection } from "@/composable/aiConnection";
import { CONNECT_AI_ROUTE } from "@/router/ai/connect";
import { openShortcutSheet } from "@/composable/shortcuts";
import { isOwnerOrAdmin as isOwnerOrAdminRole } from "@/utils/roles";
import { askForBrowserNotifications } from "@/composable/browserNotifications";
import { hasChosenLook } from "@/components/organisms/Shell/shellState";
import { openQuickCreate } from "@/components/organisms/QuickCreateTask/quickCreateTask";
import { openWorkspaceImport } from "@/components/organisms/WorkspaceImport/workspaceImportState";

const SAMPLE_CODE = "WELCOME";

/* Facts about the workspace rather than the person: a member neither sees nor gets credit for them. */
export const WORKSPACE_STEPS = ["project", "task", "invite", "ai"];
export const MEMBER_STEPS = ["connect_ai", "my_work", "notifications", "shortcuts"];
export const ADMIN_STEPS = ["connect_ai", "project", "task", "invite", "look", "ai"];

/* The member steps are "have you opened this yet", which no stored data answers, so the screen
   itself records them on the user record when it opens. A click on the card records nothing. */
const FLAG = {
    my_work: "openedMyWork",
    notifications: "viewedNotifications",
    shortcuts: "viewedShortcuts",
    import: "importedWork",
    connect_ai: "connectAiSkipped"
};

const LABEL = {
    connect_ai: "Home.step_connect_ai",
    project: "Home.step_start_project",
    task: "Home.step_task",
    invite: "Home.step_invite",
    look: "Home.step_look",
    ai: "Home.step_ai",
    my_work: "Home.step_my_work",
    notifications: "Home.step_notifications",
    shortcuts: "Home.step_shortcuts"
};

const CTA = {
    connect_ai: "Home.connect_ai",
    project: "Home.create_project",
    task: "Home.add_first_task",
    invite: "Home.invite_team",
    look: "Home.pick_look",
    ai: "Home.turn_on_ai",
    my_work: "Home.open_my_work",
    notifications: "Home.step_notifications",
    shortcuts: "Home.see_shortcuts"
};

const ALT = {
    connect_ai: { key: "skip_connect_ai", label: "Home.skip_for_now" },
    project: { key: "import", label: "Home.import_from" },
    ai: { key: "agent", label: "Home.connect_agent" }
};

export function useOnboardingChecklist({ openCreateProject = () => {}, routeVersion = () => "" } = {}) {
    const { getters, dispatch } = useStore();
    const router = useRouter();
    const { getUser } = useGetterFunctions();
    const userId = inject("$userId");
    const companyId = inject("$companyId");

    const projects = computed(() => getters["projectData/projects"]?.data || []);
    const companyUsers = computed(() => getters["settings/companyUsers"] || []);
    const companyUser = computed(() => getters["settings/companyUserDetail"] || {});
    const isOwnerOrAdmin = computed(() => isOwnerOrAdminRole(companyUser.value.roleType));
    const me = computed(() => getUser(userId.value, "all") || {});
    const sampleProject = computed(() => projects.value.find((p) => p.ProjectCode === SAMPLE_CODE && p.deletedStatusKey !== 1) || null);
    const ownProjects = computed(() => projects.value.filter((p) => p.ProjectCode !== SAMPLE_CODE && !p.isPersonal && p.deletedStatusKey !== 1));
    const record = computed(() => onboardingRecord(me.value.homeChecklist || {}));
    const aiConfigured = computed(() => [AI_STATE.ON, AI_STATE.OFF_WORKSPACE].includes(aiAvailability.state));

    const removingSample = ref(false);

    const mark = (key) => {
        const flag = FLAG[key];
        if (flag && !record.value[flag]) saveOnboarding({ [flag]: true });
    };

    const flagged = (key) => record.value[FLAG[key]] === true;
    const firstRunDone = (step) => {
        void routeVersion();
        return isFirstRunStepDone(step);
    };

    /* The person's own connection, asked for once per workspace and only while the card can still show. */
    watch(() => Boolean(me.value._id) && record.value.dismissed !== true, (wanted) => {
        if (wanted && !(aiConnection.loaded && aiConnection.companyId === companyId.value)) loadAiConnection(companyId.value);
    }, { immediate: true });
    const connectState = computed(() => connectStateFor(aiConnection, flagged("connect_ai")));
    const connectSkipped = (key) => key === "connect_ai" && connectState.value === CONNECT_STATE.SKIPPED;

    const DONE = {
        connect_ai: () => connectState.value === CONNECT_STATE.CONNECTED,
        project: () => ownProjects.value.length > 0 || flagged("import"),
        task: () => ownProjects.value.some((p) => Number(p.lastTaskId) > 0),
        invite: () => companyUsers.value.length > 1,
        look: () => hasChosenLook(),
        ai: () => aiAvailability.state === AI_STATE.ON,
        my_work: () => flagged("my_work"),
        notifications: () => flagged("notifications") || firstRunDone(FIRST_RUN_STEPS.NOTIFICATIONS),
        shortcuts: () => flagged("shortcuts")
    };

    const keys = computed(() => (isOwnerOrAdmin.value ? ADMIN_STEPS.filter((key) => key !== "ai" || aiConfigured.value) : MEMBER_STEPS));
    const steps = computed(() => keys.value.map((key) => ({
        key,
        label: LABEL[key],
        done: DONE[key](),
        skipped: connectSkipped(key),
        ...(connectSkipped(key) ? { note: "Home.step_skipped" } : {}),
        cta: CTA[key],
        alt: ALT[key] || null
    })));
    const complete = computed(() => steps.value.every((s) => s.done || s.skipped));
    const show = computed(() => record.value.dismissed !== true && !complete.value);
    const dismiss = () => saveOnboarding({ dismissed: true });

    const go = (name, extra = {}) => router.push({ name, params: { cid: companyId.value }, ...extra }).catch(() => {});

    const removeSample = async () => {
        if (removingSample.value) return false;
        removingSample.value = true;
        try {
            const response = await apiRequest("delete", "/api/v2/sample-data");
            if (!response.data?.status) throw new Error(response.data?.statusText || "remove failed");
            await dispatch("projectData/setProjects", { roleType: companyUser.value.roleType }).catch(() => {});
            return true;
        } finally {
            removingSample.value = false;
        }
    };

    /* Returns false for the one action the view has to confirm first (remove_sample). */
    const onAction = (key) => {
        if (key === "project") openCreateProject();
        else if (key === "import") openWorkspaceImport();
        else if (key === "task") {
            const target = ownProjects.value[0] || sampleProject.value;
            if (target) openQuickCreate({ projectId: String(target._id) });
            else openCreateProject();
        } else if (key === "invite") go("Members");
        else if (key === "look") go("My Profile", { query: { section: "look" } });
        else if (key === "connect_ai") go(CONNECT_AI_ROUTE);
        else if (key === "skip_connect_ai") mark("connect_ai");
        else if (key === "ai") go("Setting");
        else if (key === "agent") go(router.hasRoute("Connections") ? "Connections" : "Setting");
        else if (key === "my_work") go("Home", { query: { filter: "assigned" } });
        else if (key === "notifications") {
            askForBrowserNotifications(userId.value);
            go("Notifications");
        } else if (key === "shortcuts") openShortcutSheet();
        else if (key === "remove_sample") return false;
        return true;
    };

    return { steps, show, complete, isOwnerOrAdmin, sampleProject, removingSample, mark, dismiss, onAction, removeSample };
}
