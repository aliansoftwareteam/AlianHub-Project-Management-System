<template>
    <span hidden></span>
</template>

<script setup>
import { computed, inject, onUnmounted, watch } from "vue";

defineOptions({ name: "TourComponet" });
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useGetterFunctions } from "@/composable";
import { tourHepler } from "@/components/organisms/Tour/helper";
import { STEPS, screenFor, doneKey, mayAutoOffer } from "@/components/organisms/Tour/tourSteps";
import { onboardingRecord, saveOnboarding } from "@/composable/onboardingState";

const STEP_STORAGE = "ah.tour.step";
// Skip means "not now": the tour stops offering itself, but the Home checklist can still start it.
const SKIP_STORAGE = "ah.tour.skipped";
const MIN_WIDTH = 767;

const { t } = useI18n();
const route = useRoute();
const { getUser } = useGetterFunctions();
const { updateTourStatusInUser } = tourHepler();
const userId = inject("$userId");
const clientWidth = inject("$clientWidth");

const me = computed(() => getUser(userId.value, "all") || {});
const tourStatus = computed(() => me.value.tourStatus || {});
const wideEnough = computed(() => clientWidth.value > MIN_WIDTH);
const screen = computed(() => screenFor(route));
const isDone = (which) => tourStatus.value[doneKey(which)] === true;

const stepKey = (which) => `${STEP_STORAGE}.${which}`;
const skipKey = (which) => `${SKIP_STORAGE}.${which}`;
const savedStep = (which) => Number(localStorage.getItem(stepKey(which)) || 0);
const skipped = (which) => localStorage.getItem(skipKey(which)) === "1";

let driverObj = null;
let activeScreen = "";

const firstPresent = (selectors) => selectors.find((s) => document.querySelector(s));
const buildSteps = (which) => STEPS[which].map((s, i, all) => ({
    element: firstPresent(s.els),
    popover: {
        title: t(`Auth.tour_${which}_${s.key}_title`),
        description: t(`Auth.tour_${which}_${s.key}_body`),
        side: s.side,
        align: s.align,
        nextBtnText: i < all.length - 1 ? t("Auth.tour_next", { label: t(`Auth.tour_${which}_${s.key}_next`) }) : t("Auth.tour_done")
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
    label.textContent = t("Auth.tour_step", { a: index + 1, b: total });
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
    skip.textContent = t("Auth.tour_skip");
    skip.addEventListener("click", () => { pauseTour(); localStorage.setItem(skipKey(activeScreen), "1"); driverObj?.destroy(); });
    const meta = document.createElement("span");
    meta.className = "ah-tour__meta";
    meta.textContent = t("Auth.tour_meta", { n: total, s: total * 10 });
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

const offer = (which) => {
    const allowed = mayAutoOffer(which, {
        done: isDone(which),
        skipped: skipped(which),
        savedStep: savedStep(which),
        offeredBefore: onboardingRecord(me.value.homeChecklist || {}).toursOffered.includes(which),
        wide: wideEnough.value,
        shellSettled: isDone("shell") || skipped("shell")
    });
    if (!allowed) return;
    saveOnboarding({ tourOffered: which });
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
