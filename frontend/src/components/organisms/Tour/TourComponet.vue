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
import { computed, inject, onUnmounted, ref, watch } from "vue";

defineOptions({ name: "TourComponet" });
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useGetterFunctions } from "@/composable";
import { tourHepler } from "@/components/organisms/Tour/helper";
import { STEPS, screenFor, doneKey } from "@/components/organisms/Tour/tourSteps";
import { SAMPLE_PROJECT_NAME } from "@/components/organisms/CreateProject/templates";

const STEP_STORAGE = "ah.tour.step";
// Skip means "not now": the tour stops offering itself on every visit, but the
// Getting-started card can still start it.
const SKIP_STORAGE = "ah.tour.skipped";
const DISMISS_STORAGE = "ah.gs.dismissed";
const MIN_WIDTH = 767;

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { getters } = useStore();
const { getUser } = useGetterFunctions();
const { updateTourStatusInUser } = tourHepler();
const userId = inject("$userId");
const companyId = inject("$companyId");
const clientWidth = inject("$clientWidth");

const helpLink = computed(() => getters["brandSettingTab/brandSettings"]?.helpLink || "");
const tourStatus = computed(() => getUser(userId.value)?.tourStatus || {});
const wideEnough = computed(() => clientWidth.value > MIN_WIDTH);
const screen = computed(() => screenFor(route));
const isDone = (which) => tourStatus.value[doneKey(which)] === true;
const shellTourDone = computed(() => isDone("shell"));

const stepKey = (which) => `${STEP_STORAGE}.${which}`;
const skipKey = (which) => `${SKIP_STORAGE}.${which}`;
const savedStep = (which) => Number(localStorage.getItem(stepKey(which)) || 0);
const skipped = (which) => localStorage.getItem(skipKey(which)) === "1";

const dismissed = ref(sessionStorage.getItem(DISMISS_STORAGE) === "1");
const dismiss = () => { dismissed.value = true; sessionStorage.setItem(DISMISS_STORAGE, "1"); };

const projects = computed(() => getters["projectData/allProjects"]?.data || []);
const users = computed(() => getters["users/users"] || []);

const go = (name) => router.push({ name, params: { cid: companyId.value } }).catch(() => {});
const items = computed(() => [
    { key: "tour", label: savedStep("shell") > 0 && !shellTourDone.value ? t("AuthV2.gs_resume_tour") : t("AuthV2.gs_take_tour"), done: shellTourDone.value, go: () => startTour("shell") },
    { key: "invite", label: t("AuthV2.gs_invite"), done: users.value.length > 1, go: () => go("Members") },
    { key: "project", label: t("AuthV2.gs_project"), done: projects.value.some((p) => p.ProjectName !== SAMPLE_PROJECT_NAME), go: () => go("Projects") },
    { key: "track", label: t("AuthV2.gs_track"), done: tourStatus.value.hasTrackedTime === true, go: () => go("Home") }
]);
const doneCount = computed(() => items.value.filter((i) => i.done).length);
const showCard = computed(() => !dismissed.value && !route.meta.hideHeader && doneCount.value < items.value.length && wideEnough.value);

let driverObj = null;
let activeScreen = "";

const firstPresent = (selectors) => selectors.find((s) => document.querySelector(s));
const buildSteps = (which) => STEPS[which].map((s, i, all) => ({
    element: firstPresent(s.els),
    popover: {
        title: t(`AuthV2.tour_${which}_${s.key}_title`),
        description: t(`AuthV2.tour_${which}_${s.key}_body`),
        side: s.side,
        align: s.align,
        nextBtnText: i < all.length - 1 ? t("AuthV2.tour_next", { label: t(`AuthV2.tour_${which}_${s.key}_next`) }) : t("AuthV2.tour_done")
    }
}));

const finishTour = (which) => {
    localStorage.removeItem(stepKey(which));
    updateTourStatusInUser(doneKey(which));
};
const pauseTour = () => {
    if (!driverObj || !activeScreen) return;
    const index = driverObj.getActiveIndex();
    if (Number.isInteger(index)) localStorage.setItem(stepKey(activeScreen), String(index));
};

const renderStepHeader = (popover, { state }) => {
    const total = STEPS[activeScreen].length;
    const index = Number.isInteger(state.activeIndex) ? state.activeIndex : 0;
    const head = document.createElement("div");
    head.className = "ah-tour__head";
    const label = document.createElement("span");
    label.className = "ah-tour__step";
    label.textContent = t("AuthV2.tour_step", { a: index + 1, b: total });
    const bars = document.createElement("div");
    bars.className = "ah-tour__bars";
    for (let i = 0; i < total; i += 1) {
        const bar = document.createElement("span");
        bar.className = `ah-tour__bar${i <= index ? " is-on" : ""}`;
        bars.appendChild(bar);
    }
    head.append(label, bars);
    popover.wrapper.insertBefore(head, popover.wrapper.firstChild);

    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "ah-tour__skip";
    skip.textContent = t("AuthV2.tour_skip");
    skip.addEventListener("click", () => { pauseTour(); localStorage.setItem(skipKey(activeScreen), "1"); driverObj?.destroy(); });
    const meta = document.createElement("span");
    meta.className = "ah-tour__meta";
    meta.textContent = t("AuthV2.tour_meta", { n: total, s: total * 10 });
    popover.footer.append(skip, meta);
};

const startTour = (which = screen.value || "shell") => {
    if (!STEPS[which] || driverObj?.isActive()) return;
    activeScreen = which;
    driverObj = driver({
        popoverClass: "ah-tour",
        showProgress: false,
        showButtons: ["next"],
        allowClose: true,
        stagePadding: 6,
        stageRadius: 10,
        animate: true,
        smoothScroll: true,
        steps: buildSteps(which),
        onPopoverRender: renderStepHeader,
        onNextClick: () => {
            if (driverObj.isLastStep()) { finishTour(which); driverObj.destroy(); return; }
            localStorage.setItem(stepKey(which), String(driverObj.getActiveIndex() + 1));
            driverObj.moveNext();
        },
        onCloseClick: () => { pauseTour(); driverObj.destroy(); },
        onDestroyStarted: () => { pauseTour(); driverObj.destroy(); }
    });
    driverObj.drive(Math.min(savedStep(which), STEPS[which].length - 1));
};
const startShellTour = () => startTour("shell");

/* Each screen offers its tour once per session, to every role, on anything wider than a phone. */
const offered = new Set();
const offer = (which) => {
    if (!which || !STEPS[which] || offered.has(which) || isDone(which) || skipped(which) || savedStep(which) > 0 || !wideEnough.value) return;
    if (which !== "shell" && !shellTourDone.value && !skipped("shell")) return;
    offered.add(which);
    setTimeout(() => { if (screen.value === which) startTour(which); }, 600);
};
watch(screen, (which) => offer(which), { immediate: true });

const handleTour = () => offer(screen.value);

onUnmounted(() => driverObj?.destroy());
defineExpose({ handleTour, startShellTour, startTour });
</script>

<style>
@import "./style.css";
</style>
