<!--
  The one wrapper every dashboard card renders inside (handoff 20a).

  The body in the default slot is mounted for the card's whole life and reports through
  useCardMeta(); the shell draws the skeleton, the empty state and the error state over it.
  Never put the slot behind a v-if on the state: a body that is unmounted while it loads
  cannot report, and one that is remounted when it reports loads again, in a loop.

  `state` ('loading' | 'ready' | 'empty' | 'error') overrides what the body reports.
  `emptyText` and `emptyAction` are the catalogue's copy, used when the body names none.
-->
<template>
    <section class="dcard" :class="{ 'dcard--live': live }">
        <header class="dcard__head">
            <span class="dcard__title" :title="title">{{ title }}</span>
            <span v-if="scope" class="dcard__scope">{{ scope }}</span>
            <span class="dcard__grow"></span>
            <span v-if="live" class="dcard__live"><i class="ah-dot ah-dot--ok"></i>{{ $t('Dash.live') }}</span>
            <slot name="actions"></slot>
            <select
                v-if="periodOptions.length"
                class="dcard__period"
                :value="periodValue"
                :title="$t('Dash.period')"
                @click.stop
                @mousedown.stop
                @change="$emit('period-change', Number($event.target.value))"
            >
                <option v-for="opt in periodOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
            </select>
            <div class="dcard__tools">
                <button v-if="showRefresh" type="button" class="dcard__tool" :title="$t('Dash.refresh')" @click.stop="$emit('refresh')" @mousedown.stop>
                    <ShellIcon name="refresh" :size="13" />
                </button>
                <button v-if="showSettings" type="button" class="dcard__tool" :title="$t('Dash.card_settings')" @click.stop="$emit('settings')" @mousedown.stop>
                    <ShellIcon name="settings" :size="13" />
                </button>
                <button v-if="showRemove" type="button" class="dcard__tool dcard__tool--danger" :title="$t('Dash.remove_card')" @click.stop="$emit('remove')" @mousedown.stop>
                    <ShellIcon name="x" :size="13" />
                </button>
            </div>
        </header>

        <div class="dcard__metric" v-if="$slots.metric && resolvedState === 'ready'">
            <slot name="metric"></slot>
        </div>

        <div class="dcard__body ah-scroll" :class="{ 'dcard__body--covered': !isReady }">
            <div class="dcard__content" data-test="dcard-content" :aria-hidden="isReady ? null : 'true'">
                <slot></slot>
            </div>
            <div v-if="resolvedState === 'loading'" class="dcard__cover" data-test="dcard-skeleton" aria-hidden="true">
                <div class="dcard__skeleton">
                    <span class="dcard__sk dcard__sk--wide"></span>
                    <span class="dcard__sk"></span>
                    <span class="dcard__sk dcard__sk--short"></span>
                </div>
            </div>
            <div v-else-if="resolvedState === 'error'" class="dcard__cover" data-test="dcard-error">
                <div class="dcard__state">
                    <p class="dcard__state-text">{{ meta.error || $t('Dash.card_error') }}</p>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="dcard-retry" @click="retry">{{ $t('Dash.try_again') }}</button>
                </div>
            </div>
            <div v-else-if="resolvedState === 'empty'" class="dcard__cover" data-test="dcard-empty">
                <div class="dcard__state">
                    <slot name="empty">
                        <p class="dcard__state-text">{{ meta.emptyText || emptyText }}</p>
                        <button
                            v-if="meta.emptyAction || emptyAction"
                            type="button"
                            class="ah-btn ah-btn--outline ah-btn--sm"
                            @click="$emit('empty-action')"
                        >{{ meta.emptyAction || emptyAction }}</button>
                    </slot>
                </div>
            </div>
        </div>

        <footer class="dcard__foot">
            <span class="dcard__note">{{ footerLeft }}</span>
            <router-link v-if="linkLabel && linkTo" class="dcard__link" :to="linkTo">{{ linkLabel }} →</router-link>
        </footer>
    </section>
</template>

<script setup>
import { computed, provide, reactive, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { CARD_META_KEY, REPORT_TIMEOUT_MS } from './useCardMeta';

defineOptions({ name: 'DashboardCard' });

const props = defineProps({
    title: { type: String, default: '' },
    scope: { type: String, default: '' },
    periodOptions: { type: Array, default: () => [] },
    periodValue: { type: [Number, String], default: 0 },
    showRefresh: { type: Boolean, default: false },
    showSettings: { type: Boolean, default: false },
    showRemove: { type: Boolean, default: false },
    live: { type: Boolean, default: false },
    footerNote: { type: String, default: '' },
    linkLabel: { type: String, default: '' },
    linkTo: { type: [Object, String], default: null },
    emptyText: { type: String, default: '' },
    emptyAction: { type: String, default: '' },
    state: { type: String, default: '' },
});

const emit = defineEmits(['period-change', 'refresh', 'settings', 'remove', 'retry', 'empty-action']);

const { t } = useI18n();
const meta = reactive({ state: '', note: '', updatedAt: null, emptyText: '', emptyAction: '', error: '' });
provide(CARD_META_KEY, meta);

// A body that has reported 'loading' owns its request and will report again. One that has said
// nothing by the deadline (its chunk failed, it threw, it does not use useCardMeta) never will,
// and showing it as ready would put an unexplained blank where its numbers should be.
const unanswered = ref(false);
let reportDeadline = null;
const awaitReport = () => {
    clearTimeout(reportDeadline);
    unanswered.value = false;
    reportDeadline = setTimeout(() => { unanswered.value = !meta.state; }, REPORT_TIMEOUT_MS);
};

const resolvedState = computed(() => props.state || meta.state || (unanswered.value ? 'error' : 'loading'));
const isReady = computed(() => resolvedState.value === 'ready');

const retry = () => {
    if (unanswered.value) awaitReport();
    emit('retry');
};

// Rule 4 of the card anatomy: a live card says so, a computed one says when it
// last ran. A stale number that looks live is worse than no number.
const loadedAt = ref(0);
const now = ref(Date.now());
let tick = null;
watch(resolvedState, (state) => { if (state !== 'loading') loadedAt.value = Date.now(); }, { immediate: true });
onMounted(() => {
    tick = setInterval(() => { now.value = Date.now(); }, 60000);
    awaitReport();
});
onBeforeUnmount(() => {
    clearInterval(tick);
    clearTimeout(reportDeadline);
});

const freshness = computed(() => {
    if (props.live) return t('Dash.live_data');
    const since = meta.updatedAt || loadedAt.value;
    if (!since) return '';
    const mins = Math.floor((now.value - since) / 60000);
    if (mins < 1) return t('Dash.updated_just_now');
    if (mins < 60) return t('Dash.updated_min', { n: mins });
    const hours = Math.floor(mins / 60);
    return hours < 48 ? t('Dash.updated_hours', { n: hours }) : t('Dash.updated_days', { n: Math.floor(hours / 24) });
});
const footerLeft = computed(() => [freshness.value, meta.note || props.footerNote].filter(Boolean).join(' · '));
</script>

<style scoped>
.dcard {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    box-shadow: var(--shadow-card);
    overflow: hidden;
}
.dcard--live { border-color: var(--border); }
.dcard__head {
    display: flex;
    align-items: center;
    gap: calc(var(--sp-2) + 1px);
    padding: var(--card-pad-y, 13px) var(--card-pad-x, 15px) 0;
    min-width: 0;
}
.dcard__title {
    font: var(--text-h3);
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
}
.dcard__scope {
    font: var(--text-label);
    color: var(--ink-label);
    text-transform: uppercase;
    letter-spacing: .02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 40%;
    flex: 0 1 auto;
}
.dcard__grow { flex: 1 1 auto; }
.dcard__live {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    font: var(--text-data);
    color: var(--ok-ink);
    white-space: nowrap;
}
.dcard__period {
    height: var(--control-h-sm, 24px);
    font-family: var(--font-ui);
    font-size: var(--fs-sm, 11.5px);
    color: var(--ink-label);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-chip);
    padding: 0 var(--sp-2);
    max-width: 108px;
    cursor: pointer;
}
.dcard__period:focus-visible { outline: none; box-shadow: var(--focus); }
.dcard__tools { display: inline-flex; align-items: center; gap: 2px; }
.dcard__tool {
    display: inline-grid;
    place-items: center;
    width: var(--hit-min);
    height: var(--hit-min);
    border: 0;
    border-radius: var(--r-chip);
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
    transition: color var(--t-state) var(--ease), background var(--t-state) var(--ease);
}
.dcard__tool:hover { color: var(--ink); background: var(--surface-hover); }
.dcard__tool--danger:hover { color: var(--danger); }
.dcard__tool:focus-visible { outline: none; box-shadow: var(--focus); }
.dcard__metric { padding: var(--sp-3) var(--card-pad-x, 15px) 0; }
.dcard__body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: calc(var(--sp-3) + 1px) var(--card-pad-x, 15px) var(--card-pad-y, 12px);
}
.dcard__body--covered { overflow: hidden; }
/* The body keeps its box while it is covered, so a chart inside it measures a real size. */
.dcard__content { display: contents; }
.dcard__body--covered > .dcard__content { visibility: hidden; }
.dcard__cover {
    position: absolute;
    inset: 0;
    display: flex;
    overflow: auto;
    padding: calc(var(--sp-3) + 1px) var(--card-pad-x, 15px) var(--card-pad-y, 12px);
}
.dcard__state { display: flex; flex-direction: column; align-items: center; gap: var(--sp-3); margin: auto; text-align: center; padding: var(--sp-2) 0; }
.dcard__state-text { margin: 0; font: var(--text-small); color: var(--ink-2); max-width: 34ch; line-height: var(--lh-body, 1.5); }
.dcard__skeleton { width: 100%; display: flex; flex-direction: column; gap: var(--sp-3); margin: auto; }
.dcard__sk { height: 10px; border-radius: var(--r-sm, 5px); background: var(--surface-hover); width: 70%; }
.dcard__sk--wide { width: 100%; height: 18px; }
.dcard__sk--short { width: 45%; }
.dcard__foot {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: calc(var(--sp-2) + 1px) var(--card-pad-x, 15px) var(--card-pad-y, 11px);
    border-top: 1px solid var(--hairline);
    font: var(--text-small);
    font-size: var(--fs-sm, 11.5px);
    color: var(--ink-2);
}
.dcard__note { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcard__link {
    margin-left: auto;
    color: var(--brand);
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
}
.dcard__link:hover { text-decoration: underline; }
@media (max-width: 767px) {
    .dcard__link { display: inline-flex; align-items: center; min-height: var(--hit-min); }
    .dcard__period { height: var(--hit-min); }
}
</style>
