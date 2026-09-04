import { computed, inject, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { apiRequest, apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";
import { useGetterFunctions } from "@/composable";
import { FIRST_RUN_STEPS, isFirstRunStepDone } from "@/composable/firstRunProgress";

const SAMPLE_CODE = "WELCOME";

export const MEMBER_STEPS = ["open_project", "complete_task", "log_time", "notifications", "tour"];
export const ADMIN_STEPS = ["company", "sample", "invite", "project", "permissions", "board", "notifications", "apps", "remove_sample"];

/* Steps a click can settle live in the user document; the rest are read off data. */
const FLAG = {
    permissions: "reviewedPermissions",
    open_project: "openedProject",
    complete_task: "completedTask",
    log_time: "loggedTime",
    apps: "chosenApps"
};

export function useOnboardingChecklist({ openCreateProject = () => {}, startTour = () => {}, routeVersion = () => "" } = {}) {
    const { getters, dispatch } = useStore();
    const router = useRouter();
    const { getUser } = useGetterFunctions();
    const userId = inject("$userId");
    const companyId = inject("$companyId");

    const projects = computed(() => getters["projectData/projects"]?.data || []);
    const companyUsers = computed(() => getters["settings/companyUsers"] || []);
    const companyUser = computed(() => getters["settings/companyUserDetail"] || {});
    const isOwnerOrAdmin = computed(() => [1, 2].includes(companyUser.value.roleType));
    const me = computed(() => getUser(userId.value, "all") || {});
    const tourStatus = computed(() => me.value.tourStatus || {});
    const sampleProject = computed(() => projects.value.find((p) => p.ProjectCode === SAMPLE_CODE && p.deletedStatusKey !== 1) || null);

    const checklist = ref({ dismissed: false });
    const removingSample = ref(false);

    const load = () => {
        if (me.value.homeChecklist) checklist.value = { ...checklist.value, ...me.value.homeChecklist };
    };

    const save = (patch) => {
        checklist.value = { ...checklist.value, ...patch };
        return apiRequestWithoutCompnay("put", env.USER_UPATE, {
            userId: userId.value,
            updateObject: { $set: { homeChecklist: checklist.value } }
        }).catch((error) => console.error("checklist save failed", error));
    };

    const mark = (key) => {
        const flag = FLAG[key];
        if (flag && !checklist.value[flag]) save({ [flag]: true });
    };

    const flagged = (key) => checklist.value[FLAG[key]] === true;
    const firstRunDone = (step) => {
        void routeVersion();
        return isFirstRunStepDone(step);
    };

    const DONE = {
        company: () => true,
        sample: () => projects.value.length > 0,
        invite: () => companyUsers.value.length > 1,
        project: () => projects.value.some((p) => p.ProjectCode !== SAMPLE_CODE),
        permissions: () => flagged("permissions"),
        board: () => firstRunDone(FIRST_RUN_STEPS.BOARD_VIEW),
        notifications: () => firstRunDone(FIRST_RUN_STEPS.NOTIFICATIONS),
        apps: () => flagged("apps"),
        remove_sample: () => projects.value.length > 0 && !sampleProject.value,
        open_project: () => flagged("open_project"),
        complete_task: () => flagged("complete_task"),
        log_time: () => flagged("log_time") || tourStatus.value.hasTrackedTime === true,
        tour: () => tourStatus.value.isShellTour === true
    };

    const CTA = {
        company: "HomeV2.step_company",
        sample: "HomeV2.create_project",
        invite: "HomeV2.invite_team",
        project: "HomeV2.create_project",
        permissions: "HomeV2.review_permissions",
        board: "HomeV2.step_board",
        notifications: "HomeV2.step_notifications",
        apps: "HomeV2.choose_apps",
        remove_sample: "HomeV2.remove_sample",
        open_project: "HomeV2.open_project",
        complete_task: "HomeV2.step_complete_task",
        log_time: "HomeV2.step_log_time",
        tour: "HomeV2.take_tour"
    };

    const keys = computed(() => (isOwnerOrAdmin.value ? ADMIN_STEPS : MEMBER_STEPS));
    const steps = computed(() => keys.value.map((key) => ({
        key,
        label: `HomeV2.step_${key}`,
        note: key === "permissions" ? "HomeV2.step_permissions_note" : "",
        done: DONE[key](),
        cta: CTA[key]
    })));
    const complete = computed(() => steps.value.every((s) => s.done));
    const show = computed(() => !checklist.value.dismissed && !complete.value);
    const dismiss = () => save({ dismissed: true });

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
        if (key === "invite") go("Members");
        else if (key === "sample" || key === "project") openCreateProject();
        else if (key === "permissions") {
            mark(key);
            go(router.hasRoute("Security & Permissions") ? "Security & Permissions" : "Setting");
        } else if (key === "apps") {
            mark(key);
            go(router.hasRoute("Settings-Projects") ? "Settings-Projects" : "Setting");
        } else if (key === "board" || key === "open_project") {
            const target = sampleProject.value || projects.value[0];
            if (!target) openCreateProject();
            else {
                if (key === "open_project") mark(key);
                router.push({ name: "Project", params: { cid: companyId.value, id: target._id }, query: key === "board" ? { tab: "ProjectKanban" } : {} }).catch(() => {});
            }
        } else if (key === "notifications") go("Notifications");
        else if (key === "tour") startTour("shell");
        else if (key === "remove_sample") return false;
        return true;
    };

    return { steps, show, complete, isOwnerOrAdmin, sampleProject, removingSample, load, mark, dismiss, onAction, removeSample };
}
