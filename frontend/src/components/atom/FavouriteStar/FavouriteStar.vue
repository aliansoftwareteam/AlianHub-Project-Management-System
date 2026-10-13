<template>
    <button
        type="button"
        class="fav-star"
        :class="{ 'is-on': on }"
        :aria-pressed="on ? 'true' : 'false'"
        :aria-label="$t('Favourites.toggle', { name })"
        :title="on ? $t('Favourites.remove') : $t('Favourites.add')"
        :tabindex="tabindex"
        @click.stop.prevent="toggle"
    >
        <ShellIcon name="star" :size="size" />
    </button>
</template>

<script setup>
import { computed } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useFavourites } from "@/composable/favourites";

defineOptions({ name: "FavouriteStar" });

const props = defineProps({
    type: { type: String, required: true },
    id: { type: String, default: "" },
    name: { type: String, default: "" },
    projectId: { type: String, default: undefined },
    folderId: { type: String, default: undefined },
    sprintId: { type: String, default: undefined },
    size: { type: Number, default: 14 },
    tabindex: { type: [Number, String], default: undefined }
});

const { isFavourite, toggleFavourite } = useFavourites();

const on = computed(() => isFavourite(props.type, props.id));

function toggle() {
    const { type, id, name, projectId, folderId, sprintId } = props;
    toggleFavourite({ type, id, name, projectId, folderId, sprintId });
}
</script>

<style>
.fav-star {
    border: 0;
    background: none;
    padding: 3px;
    line-height: 0;
    cursor: pointer;
    color: var(--ink-2);
    border-radius: 5px;
    flex: none;
}
.fav-star:hover, .fav-star.is-on { color: var(--warn); }
.fav-star.is-on svg { fill: var(--warn); }
.fav-star:focus-visible { outline: none; box-shadow: var(--focus); }
</style>
