<template>
    <div class="iconpicker">
        <!-- Search + set filter -->
        <div class="iconpicker__controls">
            <input
                v-model="query"
                type="text"
                class="iconpicker__search"
                :placeholder="$t('PlaceHolder.search') + '…'"
            >
            <div class="iconpicker__sets">
                <button
                    type="button"
                    class="iconpicker__set"
                    :class="{ active: activeSet === 'all' }"
                    @click="activeSet = 'all'"
                >All</button>
                <button
                    v-for="s in sets"
                    :key="s"
                    type="button"
                    class="iconpicker__set"
                    :class="{ active: activeSet === s }"
                    @click="activeSet = s"
                >{{ s }}</button>
            </div>
        </div>

        <!-- Color + live preview -->
        <div class="iconpicker__color-row">
            <span class="iconpicker__preview">
                <Icon v-if="ready && modelValue" :icon="modelValue" :color="color" width="22" height="22" />
                <span v-else class="iconpicker__preview-empty" />
            </span>
            <label class="iconpicker__color-label">
                {{ $t('dashboardCard.color') }}
                <input type="color" class="iconpicker__color" :value="color || DEFAULT_ICON_COLOR" @input="$emit('update:color', $event.target.value)">
            </label>
        </div>

        <!-- Results grid -->
        <div v-if="!ready" class="iconpicker__msg">Loading icons…</div>
        <div v-else-if="!results.length" class="iconpicker__msg">No icons found.</div>
        <div v-else class="iconpicker__grid">
            <button
                v-for="name in results"
                :key="name"
                type="button"
                class="iconpicker__item"
                :class="{ selected: name === modelValue }"
                :title="name"
                @click="$emit('update:modelValue', name)"
            >
                <Icon :icon="name" :color="name === modelValue ? color : undefined" width="20" height="20" />
            </button>
        </div>
        <div v-if="ready && truncated" class="iconpicker__more">
            Showing first {{ RESULT_LIMIT }} — refine your search.
        </div>
    </div>
</template>

<script setup>
// Curated Iconify picker. Emits the chosen icon name (v-model) and color
// (v-model:color). Loads the sets offline on mount. See PRD §5.3.
import { computed, onMounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { loadIconSets, isLoaded, searchIcons, CURATED_SETS, DEFAULT_ICON_COLOR } from '@/utils/iconLibrary';

defineProps({
    modelValue: { type: String, default: '' },
    color: { type: String, default: DEFAULT_ICON_COLOR },
});
defineEmits(['update:modelValue', 'update:color']);

const RESULT_LIMIT = 120;
const sets = CURATED_SETS;
const query = ref('');
const activeSet = ref('all');
const ready = ref(isLoaded());

onMounted(async () => {
    if (!ready.value) {
        try { await loadIconSets(); } catch { /* offline load failure — grid stays empty */ }
        ready.value = isLoaded();
    }
});

const results = computed(() => {
    if (!ready.value) return [];
    return searchIcons(query.value, { limit: RESULT_LIMIT, set: activeSet.value === 'all' ? null : activeSet.value });
});
const truncated = computed(() => results.value.length >= RESULT_LIMIT);
</script>

<style scoped>
.iconpicker { display: flex; flex-direction: column; gap: 10px; }
.iconpicker__controls { display: flex; flex-direction: column; gap: 8px; }
.iconpicker__search {
    width: 100%; box-sizing: border-box; padding: 7px 10px;
    border: 1px solid #e2e5ee; border-radius: 6px; font-size: 13px; outline: none;
}
.iconpicker__search:focus { border-color: #2F3990; }
.iconpicker__sets { display: flex; gap: 6px; flex-wrap: wrap; }
.iconpicker__set {
    border: 1px solid #e2e5ee; background: #fff; color: #6b7280;
    border-radius: 14px; padding: 3px 12px; font-size: 11.5px; cursor: pointer; text-transform: capitalize;
}
.iconpicker__set.active { background: #2F3990; border-color: #2F3990; color: #fff; }
.iconpicker__color-row { display: flex; align-items: center; gap: 12px; }
.iconpicker__preview {
    display: inline-flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; border: 1px solid #e2e5ee; border-radius: 6px;
}
.iconpicker__preview-empty { width: 22px; height: 22px; background: #f1f2f6; border-radius: 4px; }
.iconpicker__color-label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #6b7280; }
.iconpicker__color { width: 28px; height: 28px; padding: 0; border: 1px solid #e2e5ee; border-radius: 4px; cursor: pointer; background: none; }
.iconpicker__grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(34px, 1fr));
    gap: 4px; max-height: 220px; overflow-y: auto; padding: 2px;
}
.iconpicker__item {
    display: inline-flex; align-items: center; justify-content: center;
    height: 34px; border: 1px solid transparent; border-radius: 6px;
    background: #f7f8fb; color: #3a3f52; cursor: pointer;
}
.iconpicker__item:hover { background: #eef0f6; }
.iconpicker__item.selected { border-color: #2F3990; background: #eef1ff; }
.iconpicker__msg, .iconpicker__more { font-size: 12px; color: #9aa0b4; padding: 6px 2px; }
</style>
