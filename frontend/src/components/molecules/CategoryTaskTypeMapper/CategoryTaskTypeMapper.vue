<template>
    <div class="cttm">
        <label class="cttm-label">{{ $t('dashboardCard.category_template') }}</label>
        <p class="cttm-hint">{{ $t('dashboardCard.category_template_hint') }}</p>

        <div class="cttm-tabs">
            <button
                v-for="cat in EDITOR_CATEGORIES"
                :key="cat"
                type="button"
                class="cttm-tab"
                :class="{ 'cttm-tab-active': activeCat === cat }"
                @click="activeCat = cat"
            >
                {{ cat }}
                <span v-if="(map[cat] || []).length" class="cttm-tab-badge">{{ map[cat].length }}</span>
            </button>
        </div>

        <div class="cttm-search">
            <input v-model="search" type="text" :placeholder="$t('dashboardCard.search_task_types')" />
        </div>

        <div class="cttm-list">
            <p v-if="!taskTypes.length" class="cttm-none">{{ $t('dashboardCard.no_task_types') }}</p>
            <label v-for="tp in filteredTypes" :key="tp" class="cttm-item">
                <input type="checkbox" :checked="(map[activeCat] || []).includes(tp)" @change="toggleType(tp)" />
                <span class="cttm-name">{{ tp }}</span>
                <span v-if="assignedCat(tp) && assignedCat(tp) !== activeCat" class="cttm-tag">{{ assignedCat(tp) }}</span>
            </label>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { useStore } from 'vuex';

// Category → task-type template editor. Embedded inside the standard
// edit-card settings modal (CardFieldComponent) for the "Work by Category"
// card. Mutates a local map and emits the whole object back so it saves
// through the normal card-config submit path.
const props = defineProps({
    modelValue: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['update:modelValue']);

const EDITOR_CATEGORIES = ['Development', 'Marketing', 'UI/UX', 'QA'];
const activeCat = ref(EDITOR_CATEGORIES[0]);
const search = ref('');

const { getters } = useStore();
const taskTypes = computed(() => {
    const out = new Set();
    const push = (arr) => (arr || []).forEach((s) => {
        const n = s && (s.name || s.TaskType || s.label);
        if (n) out.add(String(n));
    });
    const all = getters['settings/AllTaskType'];
    if (all && Array.isArray(all.settings)) push(all.settings);
    if (!out.size) {
        (getters['settings/taskType'] || []).forEach((grp) => {
            if (grp && Array.isArray(grp.settings)) push(grp.settings);
            else if (grp && grp.name) out.add(String(grp.name));
        });
    }
    return [...out].sort((a, b) => a.localeCompare(b));
});

// Local working copy, seeded from the saved template (+ the fixed categories).
const map = reactive({});
function seed(src) {
    Object.keys(map).forEach((k) => delete map[k]);
    EDITOR_CATEGORIES.forEach((c) => { map[c] = []; });
    const s = src && typeof src === 'object' ? src : {};
    Object.keys(s).forEach((c) => { if (Array.isArray(s[c])) map[c] = s[c].slice(); });
}
seed(props.modelValue);
watch(() => props.modelValue, (v) => {
    // Only reseed when the incoming value genuinely differs (avoids clobbering
    // local edits when we echo our own emit back up).
    if (JSON.stringify(v || {}) !== JSON.stringify(cleaned())) seed(v);
});

const filteredTypes = computed(() => {
    const q = search.value.trim().toLowerCase();
    return taskTypes.value.filter((t) => !q || t.toLowerCase().includes(q));
});
function assignedCat(tp) {
    return Object.keys(map).find((c) => (map[c] || []).includes(tp)) || '';
}
function cleaned() {
    const out = {};
    Object.keys(map).forEach((c) => { if ((map[c] || []).length) out[c] = map[c].slice(); });
    return out;
}
function toggleType(tp) {
    // Where the type sits BEFORE we touch anything — captured up front so the
    // unassign case works (checking after removal would always read "unassigned"
    // and immediately re-add it to the active category).
    const current = assignedCat(tp);
    // A task type belongs to exactly one category — clear it everywhere first.
    Object.keys(map).forEach((c) => {
        const i = (map[c] || []).indexOf(tp);
        if (i !== -1) map[c].splice(i, 1);
    });
    // It was already in the active category → ticking it off = unassign (leave
    // it removed). Otherwise (unassigned, or in another category) → assign/move
    // it to the active category.
    if (current !== activeCat.value) {
        if (!map[activeCat.value]) map[activeCat.value] = [];
        map[activeCat.value].push(tp);
    }
    emit('update:modelValue', cleaned());
}
</script>

<style scoped>
.cttm { margin-top: 4px; }
.cttm-label { display: block; font-size: 13px; font-weight: 600; color: #1F212A; margin-bottom: 3px; }
.cttm-hint { font-size: 11px; color: #9aa0b4; margin: 0 0 8px; line-height: 1.45; }
.cttm-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.cttm-tab { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: #4A5061; background: #F4F5FA; border: 1px solid transparent; border-radius: 16px; padding: 4px 12px; cursor: pointer; }
.cttm-tab-active { background: #E8EAFB; color: #2F3990; border-color: #2F3990; }
.cttm-tab-badge { background: #2F3990; color: #fff; font-size: 10px; border-radius: 8px; padding: 0 5px; line-height: 15px; }
.cttm-search { margin-bottom: 6px; }
.cttm-search input { width: 100%; box-sizing: border-box; font-size: 12px; color: #3a3f52; border: 1px solid #E5E7EB; border-radius: 6px; padding: 6px 9px; outline: none; }
.cttm-search input:focus { border-color: #2F3990; box-shadow: 0 0 0 2px rgba(47, 57, 144, 0.1); }
.cttm-list { max-height: 160px; overflow-y: auto; border: 1px solid #EEF0F5; border-radius: 6px; padding: 4px; }
.cttm-item { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 5px; cursor: pointer; font-size: 12px; color: #3a3f52; }
.cttm-item:hover { background: #F7F8FB; }
.cttm-item input { accent-color: #2F3990; cursor: pointer; }
.cttm-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cttm-tag { font-size: 10px; color: #6B7280; background: #F1F3F9; border-radius: 4px; padding: 1px 6px; flex-shrink: 0; }
.cttm-none { font-size: 12px; color: #9aa0b4; padding: 8px; margin: 0; }
</style>
