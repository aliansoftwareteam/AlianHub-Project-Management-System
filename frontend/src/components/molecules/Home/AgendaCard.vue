<template>
    <section class="hc-card hc-agenda" style="flex: 1">
        <div class="hc-card__head">
            <span class="hc-card__title">{{ $t('Home.agenda') }}</span>
            <span class="hc-agenda__nav">
                <button type="button" :aria-label="$t('Home.day')" @click="$emit('shift', -1)">‹</button>
                <button type="button" @click="$emit('shift', 0)">{{ dayLabel }}</button>
                <button type="button" :aria-label="$t('Home.day')" @click="$emit('shift', 1)">›</button>
            </span>
        </div>
        <router-link v-if="!connected" class="hc-connect" :to="connectTo">
            <span class="hc-connect__ico"></span>{{ $t('Home.connect_calendar') }}
        </router-link>
        <p v-if="!items.length" class="hc-hint" style="margin: 0">{{ firstRun ? $t('Home.agenda_hint') : $t('Home.agenda_empty') }}</p>
        <div v-for="item in items" :key="item.id" class="hc-agenda__item">
            <span class="hc-agenda__time">{{ item.start.format('HH:mm') }}</span>
            <div class="hc-block" :class="`hc-block--${item.kind}`" :title="item.title">
                <template v-if="item.kind === 'reminder'">{{ $t('Home.reminder_prefix', { title: item.title }) }}</template>
                <template v-else-if="item.kind === 'focus'">{{ $t('Home.focus_prefix', { title: item.title || durationLabel(item) }) }}</template>
                <template v-else>{{ item.title }} <span class="ah-mono" style="color: var(--ink-3); font-size: 10.5px">({{ durationLabel(item) }})</span></template>
            </div>
        </div>
    </section>
</template>

<script setup>
import { computed, defineEmits, defineProps, inject } from "vue";
import moment from "moment";
import { useRouter } from "vue-router";
import { fmtEstimate } from "./homeFormat";

defineOptions({ name: "AgendaCard" });

const props = defineProps({
    day: { type: Object, required: true },
    items: { type: Array, default: () => [] },
    connected: { type: Boolean, default: false },
    firstRun: { type: Boolean, default: false }
});
defineEmits(["shift"]);

const router = useRouter();
const companyId = inject("$companyId");

const dayLabel = computed(() => (moment(props.day).isSame(moment(), "day") ? "TODAY" : moment(props.day).format("ddd D").toUpperCase()));
const connectTo = computed(() => ({ name: router.hasRoute("IntegrationsHub") ? "IntegrationsHub" : "Setting", params: { cid: companyId.value } }));
const durationLabel = (item) => fmtEstimate(item.end.diff(item.start, "minutes"));
</script>
