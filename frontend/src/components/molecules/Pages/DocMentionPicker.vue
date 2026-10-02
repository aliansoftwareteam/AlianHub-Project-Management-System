<template>
    <div
        :id="listId"
        class="dmp"
        role="listbox"
        :aria-label="$t('Docs.mention_picker')"
        :style="placement"
        @mousedown.prevent
    >
        <template v-for="group in groups" :key="group.type">
            <div class="ah-label dmp__group">{{ $t(group.label) }}</div>
            <button
                v-for="item in group.items"
                :id="optionId(item)"
                :key="optionId(item)"
                type="button"
                role="option"
                class="dmp__row"
                :class="{ 'is-active': isActive(item) }"
                :aria-selected="isActive(item)"
                @click="pick(item)"
                @mouseenter="active = flat.indexOf(item)"
            >
                <span v-if="item.type === 'user'" class="ah-avatar ah-avatar--sm">
                    <img v-if="item.image" :src="item.image" alt="">
                    <template v-else>{{ item.initials }}</template>
                </span>
                <span v-else-if="item.type === 'task'" class="ah-chip ah-chip--mono dmp__key">{{ item.meta }}</span>
                <span v-else class="dmp__glyph" aria-hidden="true"><ShellIcon name="docs" :size="12" /></span>
                <span class="dmp__name">{{ item.name ?? item.label }}</span>
            </button>
        </template>
        <div v-if="!flat.length" class="dmp__empty" role="status">{{ loading ? $t('Docs.mention_searching') : $t('Docs.mention_no_results') }}</div>
    </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';

defineOptions({ name: 'DocMentionPicker' });

const GROUP_LIMIT = 5;
const SEARCH_DELAY = 200;

const props = defineProps({
    query: { type: String, default: '' },
    position: { type: Object, default: () => ({ top: 0, left: 0 }) },
    sources: { type: Object, required: true },
});

const emit = defineEmits(['pick', 'close', 'ready']);

const listId = `dmp-${Math.random().toString(36).slice(2, 8)}`;
const people = ref([]);
const docs = ref([]);
const tasks = ref([]);
const loading = ref(false);
const active = ref(0);
let timer = null;
let latest = 0;

const groups = computed(() => [
    { type: 'user', label: 'Docs.mention_people', items: people.value },
    { type: 'doc', label: 'Docs.mention_docs', items: docs.value },
    { type: 'task', label: 'Docs.mention_tasks', items: tasks.value },
].filter((group) => group.items.length));
const flat = computed(() => groups.value.flatMap((group) => group.items));

/* A `bottom` anchors the list by its foot, for a field with no room below it: the list's height is not known beforehand. */
const placement = computed(() => ({
    left: `${props.position.left}px`,
    ...(props.position.bottom === undefined ? { top: `${props.position.top}px` } : { bottom: `${props.position.bottom}px` }),
}));

const optionId = (item) => `${listId}-${item.type}-${item.id}`;
const isActive = (item) => flat.value.indexOf(item) === active.value;

async function search(query) {
    const ticket = ++latest;
    people.value = props.sources.people(query).slice(0, GROUP_LIMIT);
    loading.value = true;
    const [foundDocs, foundTasks] = await Promise.all([
        props.sources.docs(query).catch(() => []),
        query.trim() ? props.sources.tasks(query).catch(() => []) : Promise.resolve([]),
    ]);
    if (ticket !== latest) return;
    docs.value = foundDocs.slice(0, GROUP_LIMIT);
    tasks.value = foundTasks.slice(0, GROUP_LIMIT);
    loading.value = false;
    if (!flat.value.length && /\s/.test(query)) emit('close');
}

watch(() => props.query, (query) => {
    active.value = 0;
    clearTimeout(timer);
    timer = setTimeout(() => search(query), SEARCH_DELAY);
}, { immediate: true });

function pick(item) {
    if (item) emit('pick', { type: item.type, id: item.id, label: item.label });
}

function move(step) {
    const count = flat.value.length;
    if (!count) return;
    active.value = (active.value + step + count) % count;
    nextTick(() => {
        const option = document.getElementById(optionId(flat.value[active.value]));
        if (option && option.scrollIntoView) option.scrollIntoView({ block: 'nearest' });
    });
}

function choose() {
    const item = flat.value[active.value];
    if (!item) return false;
    pick(item);
    return true;
}

onMounted(() => emit('ready', { move, choose }));
onBeforeUnmount(() => clearTimeout(timer));
</script>

<style scoped>
.dmp {
    position: fixed;
    z-index: 1100;
    width: min(320px, calc(100vw - 16px));
    max-height: min(320px, 50vh);
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 11px;
    box-shadow: var(--shadow-pop);
}
.dmp__group { padding: 6px 8px 2px; }
.dmp__row {
    display: flex; align-items: center; gap: 8px;
    min-height: 32px; padding: 5px 8px;
    border: 0; border-radius: 7px; background: transparent;
    font: 400 13px var(--font-ui); color: var(--ink); text-align: left; cursor: pointer;
}
.dmp__row.is-active,
.dmp__row:hover { background: var(--brand-tint); }
.dmp__glyph {
    width: 20px; height: 20px; flex: none; display: inline-grid; place-items: center;
    border-radius: 6px; background: var(--surface-2); color: var(--ink-2);
}
.dmp__key { flex: none; font-size: 11px; }
.dmp__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dmp__empty { font: var(--text-small); color: var(--ink-2); padding: 6px 8px; }
</style>
