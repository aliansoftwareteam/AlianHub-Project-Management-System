<!--
  DashboardCard — the one wrapper every dashboard card renders inside (handoff 20a).

  Anatomy, top to bottom: title + mono scope tag + chrome (period, refresh, settings,
  remove) · body · footer with the freshness line and the link that opens the real view.

  Props
    title           string   card name
    scope           string   mono tag saying whose data it is — MINE, MY TEAM, WORKSPACE, a project
    periodOptions   array    [{ id, label }] — renders the period <select> when non-empty
    periodValue     number   selected period id
    showRefresh     bool     render the refresh control
    showSettings    bool     render the settings control
    showRemove      bool     render the remove control
    live            bool     the body is live rather than computed — shows the LIVE tag
    footerNote      string   default freshness / caption line (a body can override via meta.note)
    linkLabel/linkTo         the footer door: a router location for the same data, unfiltered
    emptyText/emptyAction    default empty-state copy; emptyAction names the next action
    state           string   'loading' | 'ready' | 'empty' | 'error' — overrides the body's own

  Emits: period-change, refresh, settings, remove, retry, empty-action

  Slots
    default   the body (list, bars, chart or table)
    metric    optional headline row above the body — one number and one comparison
    actions   extra chrome, left of the built-in controls
    empty     replaces the default empty state

  A card body drives the state through useCardMeta() rather than props, so the grid
  does not have to know which cards can be empty.
-->
<template>
    <section class="dcard" :class="{ 'dcard--live': live }">
        <header class="dcard__head">
            <span class="dcard__title" :title="title">{{ title }}</span>
            <span v-if="scope" class="dcard__scope">{{ scope }}</span>
            <span class="dcard__grow"></span>
            <span v-if="live" class="dcard__live"><i class="ah-dot ah-dot--ok"></i>{{ $t('DashV2.live') }}</span>
            <slot name="actions"></slot>
            <select
                v-if="periodOptions.length"
                class="dcard__period"
                :value="periodValue"
                :title="$t('DashV2.period')"
                @click.stop
                @mousedown.stop
                @change="$emit('period-change', Number($event.target.value))"
            >
                <option v-for="opt in periodOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
            </select>
            <div class="dcard__tools">
                <button v-if="showRefresh" type="button" class="dcard__tool" :title="$t('DashV2.refresh')" @click.stop="$emit('refresh')" @mousedown.stop>
                    <ShellIcon name="refresh" :size="13" />
                </button>
                <button v-if="showSettings" type="button" class="dcard__tool" :title="$t('DashV2.card_settings')" @click.stop="$emit('settings')" @mousedown.stop>
                    <ShellIcon name="settings" :size="13" />
                </button>
                <button v-if="showRemove" type="button" class="dcard__tool dcard__tool--danger" :title="$t('DashV2.remove_card')" @click.stop="$emit('remove')" @mousedown.stop>
                    <ShellIcon name="x" :size="13" />
                </button>
            </div>
        </header>

        <div class="dcard__metric" v-if="$slots.metric && resolvedState === 'ready'">
            <slot name="metric"></slot>
        </div>

        <div class="dcard__body ah-scroll" :class="{ 'dcard__body--center': resolvedState !== 'ready' }">
            <div v-if="resolvedState === 'loading'" class="dcard__skeleton" aria-hidden="true">
                <span class="dcard__sk dcard__sk--wide"></span>
                <span class="dcard__sk"></span>
                <span class="dcard__sk dcard__sk--short"></span>
            </div>
            <div v-else-if="resolvedState === 'error'" class="dcard__state">
                <p class="dcard__state-text">{{ meta.error || $t('DashV2.card_error') }}</p>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="$emit('retry')">{{ $t('DashV2.try_again') }}</button>
            </div>
            <div v-else-if="resolvedState === 'empty'" class="dcard__state">
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
            <slot v-else></slot>
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
import { CARD_META_KEY } from './useCardMeta';

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

defineEmits(['period-change', 'refresh', 'settings', 'remove', 'retry', 'empty-action']);

const { t } = useI18n();
const meta = reactive({ state: 'loading', note: '', updatedAt: null, emptyText: '', emptyAction: '', error: '' });
provide(CARD_META_KEY, meta);

const resolvedState = computed(() => props.state || meta.state || 'ready');

// Rule 4 of the card anatomy: a live card says so, a computed one says when it
// last ran. A stale number that looks live is worse than no number.
const loadedAt = ref(0);
const now = ref(Date.now());
let tick = null;
watch(resolvedState, (state) => { if (state !== 'loading') loadedAt.value = Date.now(); }, { immediate: true });
onMounted(() => { tick = setInterval(() => { now.value = Date.now(); }, 60000); });
onBeforeUnmount(() => clearInterval(tick));

const freshness = computed(() => {
    if (props.live) return t('DashV2.live_data');
    if (!loadedAt.value) return '';
    const mins = Math.floor((now.value - loadedAt.value) / 60000);
    return mins < 1 ? t('DashV2.updated_just_now') : t('DashV2.updated_min', { n: mins });
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
    gap: 7px;
    padding: 13px 15px 0;
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
    gap: 4px;
    font: var(--text-data);
    color: var(--ok-ink);
    white-space: nowrap;
}
.dcard__period {
    font-family: var(--font-ui);
    font-size: 11.5px;
    color: var(--ink-label);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-chip);
    padding: 2px 6px;
    max-width: 108px;
    cursor: pointer;
}
.dcard__period:focus-visible { outline: none; box-shadow: var(--focus); }
.dcard__tools { display: inline-flex; align-items: center; gap: 2px; }
.dcard__tool {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: var(--r-chip);
    background: transparent;
    color: var(--ink-3);
    cursor: pointer;
    transition: color var(--t-state) var(--ease), background var(--t-state) var(--ease);
}
.dcard__tool:hover { color: var(--ink); background: var(--surface-hover); }
.dcard__tool--danger:hover { color: var(--danger); }
.dcard__tool:focus-visible { outline: none; box-shadow: var(--focus); }
.dcard__metric { padding: 8px 15px 0; }
.dcard__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 9px 15px 12px;
}
.dcard__body--center { display: flex; align-items: center; justify-content: center; }
.dcard__state { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; padding: 6px 0; }
.dcard__state-text { margin: 0; font: var(--text-small); color: var(--ink-2); max-width: 34ch; line-height: 1.5; }
.dcard__skeleton { width: 100%; display: flex; flex-direction: column; gap: 8px; }
.dcard__sk { height: 10px; border-radius: 5px; background: var(--surface-hover); width: 70%; }
.dcard__sk--wide { width: 100%; height: 18px; }
.dcard__sk--short { width: 45%; }
.dcard__foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 15px 11px;
    margin: 0 0 0 0;
    border-top: 1px solid var(--hairline);
    font: var(--text-small);
    font-size: 11.5px;
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
</style>
