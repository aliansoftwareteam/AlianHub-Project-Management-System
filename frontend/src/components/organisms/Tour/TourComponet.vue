<template>
    <Teleport to="body">
        <div v-if="stop" class="ah-coach" data-test="first-tour">
            <div v-if="ring" class="ah-coach__ring" :style="ring" aria-hidden="true"></div>
            <section
                ref="card"
                class="ah-coach__card"
                role="dialog"
                aria-modal="false"
                aria-labelledby="ah-coach-title"
                aria-describedby="ah-coach-body"
                :style="{ left: `${spot.left}px`, top: `${spot.top}px` }"
            >
                <div class="ah-coach__count">{{ t('Auth.tour_step', { a: index + 1, b: STOPS.length }) }}</div>
                <h2 id="ah-coach-title" class="ah-coach__title">{{ t(`Auth.tour_first_${stop.key}_title`) }}</h2>
                <div id="ah-coach-body" aria-live="polite">
                    <p class="ah-coach__body">{{ t(`Auth.tour_first_${stop.key}_body`) }}</p>
                    <p v-if="hint" class="ah-coach__key"><kbd class="ah-kbd">{{ hint }}</kbd> {{ t(`Auth.tour_first_${stop.key}_key`) }}</p>
                </div>
                <div class="ah-coach__foot">
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="tour-skip" @click="skip">{{ t('Auth.tour_skip') }}</button>
                    <button v-if="index" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="tour-back" @click="go(index - 1)">{{ t('Auth.tour_back') }}</button>
                    <button ref="nextBtn" type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="tour-next" @click="next">
                        {{ index < STOPS.length - 1 ? t('Auth.tour_next_stop') : t('Auth.tour_done') }}
                    </button>
                </div>
            </section>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, inject, nextTick, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { useGetterFunctions } from "@/composable";
import { isBlockingSurfaceOpen } from "@/composable/blockingSurface";
import { isEditableTarget, shortcutHint } from "@/composable/shortcuts";
import { onboardingRecord, saveOnboarding } from "@/composable/onboardingState";
import { shellState } from "@/components/organisms/Shell/shellState";
import { TOUR, STOPS, mayAutoStart, placePopover } from "@/components/organisms/Tour/tourSteps";

defineOptions({ name: "TourComponet" });

/* The key the old shell tour wrote on Skip. Browsers that skipped it, and the e2e skipFirstRun
   helper, already carry it, so it keeps this tour from starting by itself. */
const SKIP_STORAGE = "ah.tour.skipped.shell";
const START_DELAY_MS = 600;
const MENU_BUTTONS = '.ah-rail__item--btn[aria-haspopup="menu"], .ah-tabbar [data-test="tab-more"]';

const { t } = useI18n();
const route = useRoute();
const { getUser } = useGetterFunctions();
const userId = inject("$userId");

const me = computed(() => getUser(userId.value, "all") || {});
const record = computed(() => onboardingRecord(me.value.homeChecklist || {}));
const seen = computed(() => record.value.toursOffered.includes(TOUR));

const index = ref(-1);
const stop = computed(() => STOPS[index.value] || null);
const hint = computed(() => (stop.value ? shortcutHint(stop.value.shortcut, t) : ""));
const card = ref(null);
const nextBtn = ref(null);
const spot = ref({ left: 0, top: 0 });
const ring = ref(null);
let returnFocusTo = null;
let startTimer = null;

const skipped = () => {
    try {
        return localStorage.getItem(SKIP_STORAGE) === "1";
    } catch {
        return false;
    }
};

const onScreen = (el) => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.right > 0 && box.bottom > 0 && box.left < window.innerWidth && box.top < window.innerHeight;
};
const anchorOf = (entry) => entry.els.map((selector) => document.querySelector(selector)).find((el) => el && onScreen(el)) || null;

function place() {
    if (!stop.value || !card.value) return;
    const anchor = anchorOf(stop.value);
    const box = anchor ? anchor.getBoundingClientRect() : null;
    const tabbar = document.querySelector(".ah-tabbar");
    const floor = !box && tabbar && onScreen(tabbar) ? tabbar.getBoundingClientRect().top : window.innerHeight;
    spot.value = placePopover(box, { width: card.value.offsetWidth, height: card.value.offsetHeight }, { width: window.innerWidth, height: floor }, stop.value.side);
    ring.value = box ? { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` } : null;
}

const onKeydown = (event) => {
    if (event.key === "Escape" && !event.defaultPrevented) close();
};

function listen(on) {
    const method = on ? "addEventListener" : "removeEventListener";
    document[method]("keydown", onKeydown);
    window[method]("resize", place);
    window[method]("scroll", place, true);
}

async function go(to) {
    index.value = to;
    await nextTick();
    place();
}

async function startTour() {
    if (stop.value) return;
    returnFocusTo = document.activeElement;
    if (!seen.value) saveOnboarding({ tourOffered: TOUR });
    listen(true);
    await go(0);
    nextBtn.value?.focus({ preventScroll: true });
}

function close() {
    if (!stop.value) return;
    index.value = -1;
    ring.value = null;
    listen(false);
    restoreFocus();
}

/* Started from the More menu, the item that had the focus is gone by now; its button is the way back. */
function restoreFocus() {
    const candidates = [returnFocusTo, ...document.querySelectorAll(MENU_BUTTONS)].filter((el) => el && document.contains(el));
    returnFocusTo = null;
    for (const el of candidates) {
        el.focus({ preventScroll: true });
        if (document.activeElement === el) return;
    }
}

function skip() {
    try {
        localStorage.setItem(SKIP_STORAGE, "1");
    } catch {
        /* the user record already says the tour was offered */
    }
    close();
}

const next = () => (index.value < STOPS.length - 1 ? go(index.value + 1) : close());

const allowed = () => mayAutoStart({
    seen: seen.value,
    skipped: skipped(),
    legacyDone: me.value.tourStatus?.isShellTour === true,
    dismissed: record.value.dismissed === true,
    blocked: isBlockingSurfaceOpen(document) || isEditableTarget(document.activeElement)
});

function offer() {
    clearTimeout(startTimer);
    if (!me.value._id || route.meta?.hideHeader || !allowed()) return;
    startTimer = setTimeout(() => { if (allowed()) startTour(); }, START_DELAY_MS);
}

watch(() => [me.value._id, route.name], offer, { immediate: true });
watch(() => route.fullPath, () => nextTick(place));
watch(() => shellState.tourAsked, (asked) => {
    if (!asked) return;
    shellState.tourAsked = false;
    startTour();
});

onUnmounted(() => {
    clearTimeout(startTimer);
    listen(false);
});
defineExpose({ handleTour: offer, startTour, close });
</script>

<style>
@import "./style.css";
</style>
