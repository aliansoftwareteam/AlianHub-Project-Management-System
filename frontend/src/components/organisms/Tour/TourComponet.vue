<template>
    <aside v-if="showCard" class="ah-gs" :aria-label="$t('AuthV2.gs_title')">
        <div class="ah-gs__head">
            <div class="ah-gs__ring" :style="{ '--p': `${Math.round((doneCount / items.length) * 100)}%` }">
                <span class="ah-gs__ring-in ah-mono">{{ doneCount }}/{{ items.length }}</span>
            </div>
            <div class="ah-gs__titles">
                <strong>{{ $t('AuthV2.gs_title') }}</strong>
                <span>{{ $t('AuthV2.gs_sub') }}</span>
            </div>
        </div>
        <ul class="ah-gs__list">
            <li v-for="item in items" :key="item.key" :class="{ 'is-done': item.done }">
                <button type="button" class="ah-gs__item" :disabled="item.done" @click="item.go">
                    <span class="ah-gs__box"><ShellIcon v-if="item.done" name="check" :size="10" /></span>
                    <span>{{ item.label }}</span>
                </button>
            </li>
        </ul>
        <div class="ah-gs__foot">
            <button type="button" class="ah-gs__dismiss" @click="dismiss">{{ $t('AuthV2.gs_dismiss') }}</button>
            <a v-if="helpLink" :href="helpLink" target="_blank" rel="noopener">{{ $t('AuthV2.gs_docs') }}</a>
        </div>
    </aside>
</template>

<script setup>
import { computed, inject, onUnmounted, ref } from "vue";

defineOptions({ name: "TourComponet" });
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useGetterFunctions } from "@/composable";
import { tourHepler } from "@/components/organisms/Tour/helper";
import { SAMPLE_PROJECT_NAME } from "@/components/organisms/CreateProject/templates";

const SHELL_TOUR_KEY = "isShellTour";
const LEGACY_SHELL_KEYS = ["isProjectAndNavbarTour", "isProjectLeftViewTour", "isProjectViewTour"];
const STEP_STORAGE = "ah.tour.step";
const DISMISS_STORAGE = "ah.gs.dismissed";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { getters } = useStore();
const { getUser } = useGetterFunctions();
const { startProjectTour, hanldeProjectTour, updateTourStatusInUser } = tourHepler();
const userId = inject("$userId");
const companyId = inject("$companyId");
const clientWidth = inject("$clientWidth");

const helpLink = computed(() => getters["brandSettingTab/brandSettings"]?.helpLink || "");
const companyUser = computed(() => getters["settings/companyUserDetail"]);
const isOwnerOrAdmin = computed(() => [1, 2].includes(companyUser.value?.roleType));
const tourStatus = computed(() => getUser(userId.value)?.tourStatus || {});
const shellTourDone = computed(() => tourStatus.value[SHELL_TOUR_KEY] === true);

const dismissed = ref(sessionStorage.getItem(DISMISS_STORAGE) === "1");
const dismiss = () => { dismissed.value = true; sessionStorage.setItem(DISMISS_STORAGE, "1"); };

const projects = computed(() => getters["projectData/allProjects"]?.data || []);
const users = computed(() => getters["users/users"] || []);
const savedStep = () => Number(localStorage.getItem(STEP_STORAGE) || 0);

const go = (name) => router.push({ name, params: { cid: companyId.value } }).catch(() => {});
const items = computed(() => [
    { key: "tour", label: savedStep() > 0 && !shellTourDone.value ? t("AuthV2.gs_resume_tour") : t("AuthV2.gs_take_tour"), done: shellTourDone.value, go: () => startShellTour() },
    { key: "invite", label: t("AuthV2.gs_invite"), done: users.value.length > 1, go: () => go("Members") },
    { key: "project", label: t("AuthV2.gs_project"), done: projects.value.some((p) => p.ProjectName !== SAMPLE_PROJECT_NAME), go: () => go("Projects") },
    { key: "track", label: t("AuthV2.gs_track"), done: tourStatus.value.hasTrackedTime === true, go: () => go("Home") }
]);
const doneCount = computed(() => items.value.filter((i) => i.done).length);
const showCard = computed(() =>
    isOwnerOrAdmin.value && !dismissed.value && !route.meta.hideHeader && doneCount.value < items.value.length && clientWidth.value > 767
);

/* Shell tour: four steps tied to the checklist. Elements come from the shell;
   each step lists fallbacks so a missing anchor degrades to a centred card. */
const STEPS = [
    { els: [".ah-rail"], side: "right", align: "start", n: 1 },
    { els: ['[data-tour="my-work"]', ".ah-app__view"], side: "left", align: "start", n: 2 },
    { els: [".ah-rail__item--btn", ".ah-rail__foot"], side: "right", align: "end", n: 3 },
    { els: ['[data-tour="timer"]', ".ah-rail__foot"], side: "right", align: "end", n: 4 }
];
let driverObj = null;

const firstPresent = (selectors) => selectors.find((s) => document.querySelector(s));
const buildSteps = () => STEPS.map((s) => ({
    element: firstPresent(s.els),
    popover: {
        title: t(`AuthV2.tour_${s.n}_title`),
        description: t(`AuthV2.tour_${s.n}_body`),
        side: s.side,
        align: s.align,
        nextBtnText: s.n < STEPS.length ? t("AuthV2.tour_next", { label: t(`AuthV2.tour_${s.n}_next`) }) : t("AuthV2.tour_done")
    }
}));

const finishShellTour = () => {
    localStorage.removeItem(STEP_STORAGE);
    updateTourStatusInUser(SHELL_TOUR_KEY);
};
const pauseShellTour = () => {
    if (!driverObj) return;
    const index = driverObj.getActiveIndex();
    if (Number.isInteger(index)) localStorage.setItem(STEP_STORAGE, String(index));
};

const renderStepHeader = (popover, { state }) => {
    const index = Number.isInteger(state.activeIndex) ? state.activeIndex : 0;
    const head = document.createElement("div");
    head.className = "ah-tour__head";
    const label = document.createElement("span");
    label.className = "ah-tour__step";
    label.textContent = t("AuthV2.tour_step", { a: index + 1, b: STEPS.length });
    const bars = document.createElement("div");
    bars.className = "ah-tour__bars";
    STEPS.forEach((_, i) => {
        const bar = document.createElement("span");
        bar.className = `ah-tour__bar${i <= index ? " is-on" : ""}`;
        bars.appendChild(bar);
    });
    head.append(label, bars);
    popover.wrapper.insertBefore(head, popover.wrapper.firstChild);

    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "ah-tour__skip";
    skip.textContent = t("AuthV2.tour_skip");
    skip.addEventListener("click", () => { pauseShellTour(); driverObj?.destroy(); });
    const meta = document.createElement("span");
    meta.className = "ah-tour__meta";
    meta.textContent = t("AuthV2.tour_meta", { n: STEPS.length, s: 40 });
    popover.footer.append(skip, meta);
};

const startShellTour = () => {
    if (driverObj?.isActive()) return;
    driverObj = driver({
        popoverClass: "ah-tour",
        showProgress: false,
        showButtons: ["next"],
        allowClose: true,
        stagePadding: 6,
        stageRadius: 10,
        animate: true,
        smoothScroll: true,
        steps: buildSteps(),
        onPopoverRender: renderStepHeader,
        onNextClick: () => {
            if (driverObj.isLastStep()) { finishShellTour(); driverObj.destroy(); return; }
            localStorage.setItem(STEP_STORAGE, String(driverObj.getActiveIndex() + 1));
            driverObj.moveNext();
        },
        onCloseClick: () => { pauseShellTour(); driverObj.destroy(); },
        onDestroyStarted: () => { pauseShellTour(); driverObj.destroy(); }
    });
    driverObj.drive(Math.min(savedStep(), STEPS.length - 1));
};

/* Legacy entry point kept for ProjectListComponent / SprintsList / useProjectTour.
   The old header tours map onto the shell tour; the others run their driver
   steps directly — no confirmation modal in front of them any more. */
const shellTourOffered = ref(false);
const handleTour = (key) => {
    if (LEGACY_SHELL_KEYS.includes(key)) {
        if (shellTourDone.value || shellTourOffered.value || savedStep() > 0 || !isOwnerOrAdmin.value || clientWidth.value <= 1024) return;
        shellTourOffered.value = true;
        setTimeout(startShellTour, 400);
        return;
    }
    if (hanldeProjectTour(key)) startProjectTour(key);
};

onUnmounted(() => driverObj?.destroy());
defineExpose({ handleTour, startShellTour });
</script>

<style>
@import "./style.css";
</style>
