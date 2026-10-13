<template>
    <Teleport to="body">
        <div class="aw-backdrop" @click.self="$emit('close')">
            <div
                ref="dialog"
                class="ah-card aw ask-why"
                role="dialog"
                aria-modal="true"
                :aria-label="$t('Ask.why_title')"
                data-test="why-panel"
                @keydown.esc.stop.prevent="$emit('close')"
                @keydown.tab="keepFocusInside"
            >
                <div class="aw__head">
                    <span class="ah-h3">{{ $t('Ask.why_title') }}</span>
                    <button ref="closer" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Ask.why_close')" data-test="why-close" @click="$emit('close')">
                        <ShellIcon name="x" :size="15" />
                    </button>
                </div>

                <div class="aw__body">
                    <p v-if="!rows.length" class="ah-empty" data-test="why-empty">{{ $t('Ask.why_empty') }}</p>

                    <template v-else>
                        <p class="ah-small ask-why__lead">{{ $t('Ask.why_lead') }}</p>
                        <p v-if="!detailed" class="ah-small ask-why__lead" data-test="why-no-permission">{{ $t('Ask.why_no_permission') }}</p>

                        <ol class="ask-why__list">
                            <li v-for="row in rows" :key="row.key" class="ask-why__row" data-test="why-row">
                                <div class="ask-why__top">
                                    <span v-if="row.kindKey" class="ah-chip ah-chip--sm" data-test="why-kind">{{ $t(row.kindKey) }}</span>
                                    <router-link v-if="row.to" :to="row.to" class="ask-why__title" data-test="why-title" @click="$emit('close')">{{ row.title }}</router-link>
                                    <span v-else class="ask-why__title" data-test="why-title">{{ row.title }}</span>
                                    <span v-if="row.cited" class="ah-chip ah-chip--brand ah-chip--sm" data-test="why-cited">{{ $t('Ask.why_cited') }}</span>
                                </div>
                                <div class="ask-why__meta">
                                    <span>{{ row.project || $t('Ask.why_no_project') }}</span>
                                    <span v-if="dateOf(row.updatedAt)">{{ $t('Ask.why_updated', { date: dateOf(row.updatedAt) }) }}</span>
                                    <span class="ah-mono">{{ row.ref }}</span>
                                </div>
                                <p v-if="row.excerpt" class="ask-why__excerpt">{{ row.excerpt }}</p>
                                <p v-if="row.reasonKey" class="ask-why__reason" data-test="why-reason">
                                    <ShellIcon :name="row.reasonIcon" :size="12" /><span>{{ $t(row.reasonKey) }}</span>
                                </p>
                            </li>
                        </ol>
                    </template>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, inject, onMounted, ref, unref } from "vue";
import moment from "moment";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { hasPermissionDetail, whyRows } from "./askWhy";

defineOptions({ name: "AskWhyPanel" });

const props = defineProps({
    sources: { type: Array, default: () => [] },
    cited: { type: Array, default: () => [] },
    privileged: { type: Boolean, default: false }
});
defineEmits(["close"]);

const FOCUSABLE = "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])";

const companyId = inject("$companyId", "");
const dialog = ref(null);
const closer = ref(null);

const rows = computed(() => whyRows(props.sources, { cited: props.cited, privileged: props.privileged, companyId: unref(companyId) }));
const detailed = computed(() => hasPermissionDetail(props.sources));

const dateOf = (value) => {
    const at = value ? moment(value) : null;
    return at && at.isValid() ? at.format("D MMM YYYY") : "";
};

const keepFocusInside = (event) => {
    const focusable = dialog.value ? [...dialog.value.querySelectorAll(FOCUSABLE)] : [];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
};

onMounted(() => { if (closer.value) closer.value.focus(); });
</script>

<style>
.ask-why { width: 680px; }
.ask-why__lead { margin: 0; }
.ask-why__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.ask-why__row { padding: 10px 12px; border: 1px solid var(--hairline); border-radius: var(--r-input); background: var(--surface); display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ask-why__top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.ask-why__title { font: 600 13px/1.35 var(--font-ui); color: var(--ink); overflow-wrap: anywhere; }
a.ask-why__title { text-decoration: none; }
a.ask-why__title:hover { color: var(--brand); text-decoration: underline; }
a.ask-why__title:focus-visible { outline: none; box-shadow: var(--focus); border-radius: 4px; }
.ask-why__meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font: var(--text-small); color: var(--ink-2); }
.ask-why__excerpt { margin: 0; font: var(--text-body); color: var(--ink-label); overflow-wrap: anywhere; }
.ask-why__reason { margin: 2px 0 0; display: flex; align-items: center; gap: 6px; font: var(--text-small); color: var(--ink-2); }
.ask-why__reason svg { flex: none; }
</style>
