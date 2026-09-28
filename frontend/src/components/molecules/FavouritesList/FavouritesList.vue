<template>
    <ul v-if="items.length" ref="listEl" class="fav-list" :aria-describedby="hintId">
        <li
            v-for="(item, index) in items"
            :key="`${item.type}:${item.id}`"
            class="fav-row"
            :class="{ 'is-dragging': dragFrom === index, 'is-over': dragOver === index && dragFrom !== index }"
            draggable="true"
            @dragstart="onDragStart($event, index)"
            @dragover.prevent="dragOver = index"
            @drop.prevent="onDrop(index)"
            @dragend="dragFrom = -1; dragOver = -1"
        >
            <button
                type="button"
                class="fav-row__handle"
                :data-index="index"
                :aria-label="$t('Favourites.reorder_named', { name: item.name })"
                :title="$t('Favourites.reorder_hint')"
                @keydown="onHandleKeydown($event, index)"
            >
                <ShellIcon name="grip" :size="12" />
            </button>
            <ShellIcon class="fav-row__icon" :name="ICONS[item.type] || 'star'" :size="13" />
            <router-link class="fav-row__link" :to="favouriteRoute(item, companyId)">{{ item.name }}</router-link>
            <button
                type="button"
                class="fav-row__remove"
                :aria-label="$t('Favourites.remove_named', { name: item.name })"
                :title="$t('Favourites.remove')"
                @click="toggleFavourite(item)"
            >
                <ShellIcon name="x" :size="12" />
            </button>
        </li>
    </ul>
    <div v-else class="hs-empty">{{ $t('Home.no_favorites') }}</div>
    <p :id="hintId" class="ah-sr-only">{{ $t('Favourites.reorder_hint') }}</p>
    <div class="ah-sr-only" aria-live="polite">{{ announcement }}</div>
</template>

<script setup>
import { computed, inject, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useFavourites } from "@/composable/favourites";

defineOptions({ name: "FavouritesList" });

const ICONS = { project: "projects", folder: "file", sprint: "checkSquare", task: "check", doc: "docs" };

const { t } = useI18n();
const cid = inject("$companyId");
const { items, toggleFavourite, moveFavourite, favouriteRoute } = useFavourites();

const companyId = computed(() => cid?.value);
const hintId = `fav-hint-${Math.random().toString(36).slice(2, 8)}`;
const listEl = ref(null);
const dragFrom = ref(-1);
const dragOver = ref(-1);
const announcement = ref("");

function move(from, to) {
    const list = items.value;
    if (to < 0 || to >= list.length || from === to) return;
    const name = list[from].name;
    moveFavourite(from, to);
    announcement.value = t("Favourites.moved", { name, n: to + 1, total: list.length });
    nextTick(() => listEl.value?.querySelector(`.fav-row__handle[data-index="${to}"]`)?.focus());
}

function onHandleKeydown(event, index) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    move(index, index + (event.key === "ArrowUp" ? -1 : 1));
}

function onDragStart(event, index) {
    dragFrom.value = index;
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
    }
}

function onDrop(index) {
    if (dragFrom.value !== -1) move(dragFrom.value, index);
    dragFrom.value = -1;
    dragOver.value = -1;
}
</script>

<style>
.fav-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.fav-row {
    display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 6px 0 2px; border-radius: 7px;
    color: var(--ink); font: 400 13px/1.3 var(--font-ui);
    transition: background var(--t-state) var(--ease);
}
.fav-row:hover { background: var(--surface-hover); }
.fav-row.is-dragging { opacity: .5; }
.fav-row.is-over { box-shadow: inset 0 2px 0 var(--brand); }
.fav-row__handle, .fav-row__remove {
    border: 0; background: transparent; color: var(--ink-2); cursor: pointer; padding: 2px; border-radius: 4px;
    line-height: 0; min-width: 24px; min-height: 24px; display: inline-flex; align-items: center; justify-content: center; flex: none;
}
.fav-row__handle { cursor: grab; opacity: 0; }
.fav-row__remove { opacity: 0; }
.fav-row:hover .fav-row__handle, .fav-row:hover .fav-row__remove,
.fav-row:focus-within .fav-row__handle, .fav-row:focus-within .fav-row__remove { opacity: 1; }
.fav-row__handle:focus-visible, .fav-row__remove:focus-visible, .fav-row__link:focus-visible { outline: none; box-shadow: var(--focus); }
.fav-row__remove:hover { color: var(--ink); }
.fav-row__icon { color: var(--warn); flex: none; }
.fav-row__link { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: inherit; text-decoration: none; border-radius: 4px; padding: 4px 0; }
.fav-row__link:hover { color: inherit; text-decoration: none; }
@media (hover: none) {
    .fav-row__handle, .fav-row__remove { opacity: 1; }
}
</style>
