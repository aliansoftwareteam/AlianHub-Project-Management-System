<template>
    <div class="ah-pop-anchor" @click.stop>
        <button type="button" class="ah-tbtn" :aria-expanded="open" aria-haspopup="menu" @click="open = !open">
            <span class="hc-status__dot" :class="{ 'hc-status__dot--dnd': dnd }"></span>
            {{ label }}
        </button>
        <transition name="ah-fade">
            <div v-if="open" class="ah-pop" role="menu">
                <div class="ah-pop__label ah-label">{{ $t('HomeV2.status_dnd') }}</div>
                <button type="button" class="ah-pop__item" role="menuitem" @click="setDnd(30, 'minutes')">{{ $t('HomeV2.dnd_30') }}</button>
                <button type="button" class="ah-pop__item" role="menuitem" @click="setDnd(1, 'hour')">{{ $t('HomeV2.dnd_1h') }}</button>
                <button type="button" class="ah-pop__item" role="menuitem" @click="setDnd(2, 'hours')">{{ $t('HomeV2.dnd_2h') }}</button>
                <button type="button" class="ah-pop__item" role="menuitem" @click="setDnd(null)">{{ $t('HomeV2.dnd_tomorrow') }}</button>
                <div class="ah-pop__sep"></div>
                <button type="button" class="ah-pop__item" :class="{ 'is-active': !dnd }" role="menuitem" @click="setAvailable">
                    <span class="hc-status__dot"></span>{{ $t('HomeV2.set_available') }}
                </button>
            </div>
        </transition>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import moment from "moment";
import { useI18n } from "vue-i18n";
import { homeState, isDnd, setPresence } from "./homeState";

defineOptions({ name: "StatusChip" });

const { t } = useI18n();
const userId = inject("$userId");
const open = ref(false);
const tick = ref(0);

const dnd = computed(() => { void tick.value; return isDnd(); });
const label = computed(() => {
    if (!dnd.value) return t("HomeV2.status_available");
    const until = homeState.presence.until;
    return until ? t("HomeV2.status_dnd_until", { time: moment(until).format("HH:mm") }) : t("HomeV2.status_dnd");
});

function setDnd(amount, unit) {
    const until = amount ? moment().add(amount, unit) : moment().add(1, "day").startOf("day").add(9, "hours");
    setPresence(userId.value, { dnd: true, until: until.toISOString() });
    open.value = false;
}
function setAvailable() {
    setPresence(userId.value, { dnd: false, until: null });
    open.value = false;
}

const close = () => { open.value = false; };
let interval = null;
onMounted(() => {
    document.addEventListener("click", close);
    interval = setInterval(() => { tick.value += 1; }, 30000);
});
onUnmounted(() => {
    document.removeEventListener("click", close);
    clearInterval(interval);
});
</script>
