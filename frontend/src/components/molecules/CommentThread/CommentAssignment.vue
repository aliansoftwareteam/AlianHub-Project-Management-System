<template>
    <div class="cm-assign" :class="{ 'is-resolved': current.resolved }">
        <template v-if="current.assigneeId">
            <span class="cm-assign__who" data-test="assigned-to">
                {{ current.resolved ? $t('Comments.resolved_by_assignee', { name: nameOf(current.assigneeId) }) : $t('Comments.assigned_to', { name: nameOf(current.assigneeId) }) }}
            </span>
            <button
                v-if="canResolve"
                type="button"
                class="cm-assign__action"
                data-test="resolve"
                :disabled="busy"
                @click="toggleResolved"
            >{{ current.resolved ? $t('Comments.reopen') : $t('Comments.resolve') }}</button>
        </template>
        <DropDown
            v-if="canAssign && !current.resolved"
            mode="listbox"
            class="cm-assign__picker"
            :id="`assign_${commentId}`"
            :title="$t('Comments.assign_to')"
            :bodyClass="{ 'cm-assign__menu': true }"
        >
            <template #button>
                <span ref="triggerLabel" class="cm-assign__action" data-test="assign">{{ current.assigneeId ? $t('Comments.reassign') : $t('Comments.assign') }}</span>
            </template>
            <template #search>
                <input
                    v-model="query"
                    type="search"
                    class="ah-input cm-assign__search"
                    data-dropdown-autofocus
                    :placeholder="$t('Comments.search_people')"
                    :aria-label="$t('Comments.search_people')"
                />
            </template>
            <template #options>
                <DropDownOption
                    v-for="person in matches"
                    :key="person.id"
                    :selected="person.id === current.assigneeId"
                    @click="pick(person.id)"
                >
                    <span class="cm-assign__option">{{ person.name }}</span>
                </DropDownOption>
                <DropDownOption v-if="current.assigneeId" data-test="unassign" @click="pick('')">
                    <span class="cm-assign__option">{{ $t('Comments.unassign') }}</span>
                </DropDownOption>
                <p v-if="!matches.length" class="cm-assign__empty">{{ $t('Comments.no_people_found') }}</p>
            </template>
        </DropDown>
        <span v-if="error" class="cm-assign__error" role="alert">{{ error }}</span>
    </div>
</template>

<script setup>
import { computed, inject, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useGetterFunctions } from "@/composable";
import { assignComment, resolveComment } from "@/composable/commentThreads";
import DropDown from "@/components/molecules/DropDown/DropDown.vue";
import DropDownOption from "@/components/molecules/DropDownOption/DropDownOption.vue";

defineOptions({ name: "CommentAssignment" });

const props = defineProps({
    comment: { type: Object, required: true },
    people: { type: Array, default: () => [] },
    allowAssign: { type: Boolean, default: true }
});

const { t } = useI18n();
const { getters } = useStore();
const { getUser } = useGetterFunctions();
const userId = inject("$userId");

const override = ref(null);
const busy = ref(false);
const error = ref("");
const query = ref("");
const triggerLabel = ref(null);

watch(() => [props.comment?.assigneeId, props.comment?.resolved], () => { override.value = null; });

const current = computed(() => ({ ...props.comment, ...(override.value || {}) }));
const commentId = computed(() => String(props.comment?._id || props.comment?.id || ""));
const me = computed(() => String(userId?.value || ""));
const isAdmin = computed(() => [1, 2].includes(Number(getters["settings/companyUserDetail"]?.roleType)));
const onIt = (id) => Boolean(id) && String(id) === me.value;

const canAssign = computed(() => props.allowAssign && !current.value.isDeleted && (!current.value.assigneeId
    || isAdmin.value || [current.value.userId, current.value.assignedBy, current.value.assigneeId].some(onIt)));
const canResolve = computed(() => isAdmin.value || [current.value.assigneeId, current.value.assignedBy].some(onIt));

const nameOf = (id) => {
    const person = props.people.find((p) => String(p.id) === String(id));
    return person?.name || getUser(id)?.Employee_Name || t("Comments.someone");
};
const matches = computed(() => {
    const words = query.value.trim().toLowerCase();
    return props.people.filter((p) => p.id && !p.ghostUser && (!words || String(p.name || "").toLowerCase().includes(words)));
});

async function run(action) {
    busy.value = true;
    error.value = "";
    try {
        const saved = await action();
        override.value = { assigneeId: saved?.assigneeId || "", resolved: saved?.resolved === true, assignedBy: saved?.assignedBy || "" };
    } catch (e) {
        error.value = e?.response?.data?.message || e?.message || t("Toast.something_went_wrong");
    } finally {
        busy.value = false;
    }
}

function pick(id) {
    triggerLabel.value?.click();
    query.value = "";
    if (String(id) === String(current.value.assigneeId || "")) return;
    run(() => assignComment(props.comment, id));
}

function toggleResolved() {
    run(() => resolveComment(props.comment, !current.value.resolved));
}
</script>

<style scoped>
.cm-assign { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); min-width: 0; }
.cm-assign__who { background: var(--warn-bg); color: var(--warn-ink); border-radius: var(--r-chip, 6px); padding: 1px 8px; overflow-wrap: anywhere; }
.cm-assign.is-resolved .cm-assign__who { background: var(--ok-bg); color: var(--ok-ink); }
.cm-assign__action { background: none; border: 0; padding: 2px 4px; color: var(--brand); font: inherit; cursor: pointer; border-radius: 4px; }
.cm-assign__action:hover { text-decoration: underline; }
.cm-assign__action:focus-visible { outline: 2px solid var(--focus, var(--brand)); outline-offset: 1px; }
.cm-assign__action:disabled { opacity: .6; cursor: default; }
.cm-assign__search { width: 100%; box-sizing: border-box; margin-bottom: 6px; }
.cm-assign__option { color: var(--ink); }
.cm-assign__empty { margin: 4px 0; color: var(--ink-2); }
.cm-assign__error { color: var(--danger-ink, var(--danger)); }
</style>
