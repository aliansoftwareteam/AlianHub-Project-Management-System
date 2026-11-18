<template>
    <div ref="anchor" class="evr__chip-anchor">
        <button
            type="button"
            class="evr__chip"
            :class="{ 'is-on': Boolean(active) }"
            :aria-expanded="open ? 'true' : 'false'"
            aria-haspopup="dialog"
            data-test="evr-views"
            @click="open = !open"
        >
            <ShellIcon name="bookmark" :size="13" aria-hidden="true" />
            <span class="evr__chip-n">{{ active ? active.name : $t('Everything.views') }}</span>
            <span v-if="dirty" class="evr__dirty" role="img" :aria-label="$t('Everything.view_changed')" :title="$t('Everything.view_changed')" data-test="evr-view-dirty"></span>
        </button>
        <div v-if="open" class="ah-pop evr__pop evr__views-pop" role="dialog" :aria-label="$t('Everything.views')">
            <div v-if="!views.length" class="evr__pop-empty">{{ $t('Everything.views_none') }}</div>
            <div v-for="view in views" :key="view._id" class="evr__view-row" :class="{ 'is-active': active && view._id === active._id }" data-test="evr-view">
                <form v-if="renaming === view._id" class="evr__view-form" @submit.prevent="commitRename(view)">
                    <input
                        v-model="draft"
                        type="text"
                        class="ah-input evr__view-name"
                        :maxlength="NAME_MAX"
                        :aria-label="$t('Everything.view_name')"
                        data-test="evr-view-rename-name"
                        @keydown.esc.stop.prevent="renaming = ''"
                    />
                    <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="!draft.trim()" data-test="evr-view-rename-save">{{ $t('Everything.save') }}</button>
                </form>
                <div v-else-if="deleting === view._id" class="evr__view-form">
                    <span class="evr__view-ask">{{ $t('Everything.view_delete_ask', { name: view.name }) }}</span>
                    <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" data-test="evr-view-delete-confirm" @click="confirmDelete(view)">{{ $t('Everything.view_delete') }}</button>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="deleting = ''">{{ $t('Everything.cancel') }}</button>
                </div>
                <template v-else>
                    <button type="button" class="ah-pop__item evr__view-open" data-test="evr-view-open" @click="choose(view._id)">
                        <span class="evr__option-label">{{ view.name }}</span>
                    </button>
                    <button
                        type="button"
                        class="evr__icon-btn"
                        :class="{ 'is-on': view.isDefault }"
                        :aria-pressed="view.isDefault ? 'true' : 'false'"
                        :title="$t(view.isDefault ? 'Everything.view_default_on' : 'Everything.view_default_set')"
                        :aria-label="$t(view.isDefault ? 'Everything.view_default_on' : 'Everything.view_default_set')"
                        data-test="evr-view-default"
                        @click="$emit('default', view)"
                    ><ShellIcon name="star" :size="14" /></button>
                    <button type="button" class="evr__icon-btn" :title="$t('Everything.view_rename')" :aria-label="$t('Everything.view_rename')" data-test="evr-view-rename" @click="startRename(view)">
                        <ShellIcon name="edit" :size="14" />
                    </button>
                    <button type="button" class="evr__icon-btn" :title="$t('Everything.view_delete')" :aria-label="$t('Everything.view_delete')" data-test="evr-view-delete" @click="deleting = view._id">
                        <ShellIcon name="trash" :size="14" />
                    </button>
                </template>
            </div>
            <button v-if="active" type="button" class="ah-pop__item" data-test="evr-view-none" @click="choose('')">{{ $t('Everything.view_none') }}</button>
            <div class="ah-pop__sep"></div>
            <button v-if="active && dirty" type="button" class="ah-pop__item" data-test="evr-view-save-changes" @click="$emit('save-changes', active)">
                {{ $t('Everything.view_save_changes', { name: active.name }) }}
            </button>
            <form class="evr__view-form" @submit.prevent="create">
                <input
                    v-model="name"
                    type="text"
                    class="ah-input evr__view-name"
                    :maxlength="NAME_MAX"
                    :placeholder="$t('Everything.view_name')"
                    :aria-label="$t('Everything.view_name')"
                    data-test="evr-view-new-name"
                />
                <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="!name.trim()" data-test="evr-view-save">{{ $t('Everything.view_save') }}</button>
            </form>
        </div>
    </div>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

defineOptions({ name: "EverythingViews" });

const NAME_MAX = 80;

defineProps({
    views: { type: Array, default: () => [] },
    active: { type: Object, default: null },
    dirty: { type: Boolean, default: false }
});
const emit = defineEmits(["open", "save", "save-changes", "rename", "default", "delete"]);

const anchor = ref(null);
const open = ref(false);
const name = ref("");
const draft = ref("");
const renaming = ref("");
const deleting = ref("");

function choose(id) {
    emit("open", id);
    open.value = false;
}

function create() {
    const title = name.value.trim();
    if (!title) return;
    emit("save", title);
    name.value = "";
    open.value = false;
}

function startRename(view) {
    deleting.value = "";
    draft.value = view.name;
    renaming.value = view._id;
}

function commitRename(view) {
    const title = draft.value.trim();
    renaming.value = "";
    if (title && title !== view.name) emit("rename", view, title);
}

function confirmDelete(view) {
    deleting.value = "";
    emit("delete", view);
}

const onOutside = (event) => { if (anchor.value && !anchor.value.contains(event.target)) open.value = false; };
const onEscape = (event) => { if (event.key === "Escape") open.value = false; };
const listen = (on) => {
    document[on ? "addEventListener" : "removeEventListener"]("click", onOutside);
    document[on ? "addEventListener" : "removeEventListener"]("keydown", onEscape);
};
watch(open, (isOpen) => {
    listen(isOpen);
    if (!isOpen) { renaming.value = ""; deleting.value = ""; }
});
onBeforeUnmount(() => listen(false));
</script>
