<template>
    <li class="glt" :class="{ 'is-reached': reached }" data-test="glt" :data-kind="target.kind">
        <GoalTargetForm v-if="editing" :target="target" :currencies="currencies" :busy="busy" :refusal="refusal" @save="saveEdit" @cancel="stopEditing" />
        <template v-else>
            <div class="glt__head">
                <span class="glt__name">{{ target.name }}</span>
                <span v-if="reached" class="ah-chip ah-chip--ok ah-chip--sm" data-test="glt-reached">
                    <ShellIcon name="check" :size="11" />{{ $t('Goals.reached_mark') }}
                </span>
                <span class="glt__weight">{{ $t('Goals.weight_n', { n: target.weight }) }}</span>
                <span v-if="changeable" class="glt__actions">
                    <button ref="editButton" type="button" class="glt__icon" data-test="glt-edit" :aria-label="$t('Goals.edit_target', { name: target.name })" :title="$t('Goals.edit_target', { name: target.name })" @click="editing = true">
                        <ShellIcon name="edit" :size="14" />
                    </button>
                    <button ref="removeButton" type="button" class="glt__icon" data-test="glt-remove" :aria-label="$t('Goals.remove_target', { name: target.name })" :title="$t('Goals.remove_target', { name: target.name })" @click="askRemove">
                        <ShellIcon name="trash" :size="14" />
                    </button>
                </span>
            </div>

            <div v-if="view === 'measured'" class="glt__value">
                <template v-if="settable">
                    <label class="glt__set">
                        <span class="ah-sr-only">{{ $t('Goals.value_of', { name: target.name }) }}</span>
                        <input
                            v-model="draft"
                            type="number"
                            step="any"
                            inputmode="decimal"
                            class="ah-input glt__input"
                            :class="{ 'ah-input--error': error }"
                            :aria-invalid="error ? 'true' : null"
                            :aria-describedby="error ? `${uid}-error` : null"
                            data-test="glt-value"
                            @input="error = ''"
                            @keydown.enter.prevent="saveValue"
                            @keydown.esc.stop="resetDraft"
                        />
                    </label>
                    <span v-if="suffix" class="glt__unit">{{ suffix }}</span>
                    <button v-if="dirty" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="glt-value-save" :disabled="target.saving" @click="saveValue">{{ $t('Goals.save_value') }}</button>
                </template>
                <span v-else class="glt__now">{{ amount(target.current) }}</span>
                <span class="glt__range">{{ range }}</span>
            </div>
            <div v-else-if="view === 'flag'" class="glt__value">
                <label v-if="settable" class="glt__flag">
                    <input type="checkbox" class="ah-check" data-test="glt-done" :checked="target.done" @change="saveFlag($event.target.checked)" />
                    <span>{{ $t('Goals.done') }}</span>
                </label>
                <span v-else class="glt__now">{{ $t(target.done ? 'Goals.done' : 'Goals.not_done') }}</span>
            </div>
            <span v-if="error" :id="`${uid}-error`" class="ah-field__error" role="alert" data-error-for="current">{{ error }}</span>

            <div class="glt__progress">
                <GoalBar :value="target.progressPct" :label="$t('Goals.progress_of', { name: target.name })" />
                <span class="glt__pct">{{ target.progressPct || 0 }}%</span>
                <span v-if="target.saving" class="glt__saving" role="status">{{ $t('Goals.saving') }}</span>
            </div>
            <p v-if="updated" class="glt__updated">{{ updated }}</p>

            <div v-if="removing" class="glt__confirm" role="group" :aria-label="$t('Goals.remove_target', { name: target.name })" @keydown.esc.stop="stopRemoving">
                <span>{{ $t('Goals.remove_confirm') }}</span>
                <button ref="keepButton" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="glt-remove-cancel" @click="stopRemoving">{{ $t('Goals.cancel') }}</button>
                <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" data-test="glt-remove-confirm" :disabled="busy" @click="remove">{{ $t('Goals.remove') }}</button>
            </div>
        </template>
    </li>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import GoalBar from "./GoalBar.vue";
import GoalTargetForm from "./GoalTargetForm.vue";
import { formatAmount, formatWhen } from "./goalFormat";
import { isReached, kindOf, rangeOf } from "./goalRequest";
import { useGoalPeople } from "./useGoalPeople";
import { useGoalWrite } from "./useGoalWrite";

defineOptions({ name: "GoalTarget" });

const props = defineProps({
    goal: { type: Object, required: true },
    target: { type: Object, required: true },
    currencies: { type: Array, default: () => [] }
});

const { t, locale } = useI18n();
const { personOf } = useGoalPeople();
const { write } = useGoalWrite();
const uid = `glt-${Math.random().toString(36).slice(2, 8)}`;

const editing = ref(false);
const removing = ref(false);
const busy = ref(false);
const refusal = ref(null);
const error = ref("");
const editButton = ref(null);
const removeButton = ref(null);
const keepButton = ref(null);

const text = (value) => (value === undefined || value === null ? "" : String(value));
const draft = ref(text(props.target.current));

/* 'measured' and 'flag' are the kinds a person sets by hand. Any other kind is read only here:
   it shows its name, weight and the server's percentage, and a view for it is added as a branch above. */
const view = computed(() => kindOf(props.target));
const known = computed(() => view.value !== "other");
const live = computed(() => !props.goal.archived);
const settable = computed(() => known.value && live.value && props.goal.canSetValue === true);
const changeable = computed(() => known.value && live.value && props.goal.canEdit === true);
const reached = computed(() => isReached(props.target));

const amount = (value) => formatAmount(props.target, value, locale.value);
const suffix = computed(() => (props.target.kind === "currency" ? props.target.currencyCode : props.target.unit) || "");
const range = computed(() => t(rangeOf(props.target) === "down" ? "Goals.range_down" : "Goals.range_up", { start: amount(props.target.start), target: amount(props.target.target) }));
const dirty = computed(() => text(draft.value) !== "" && Number(draft.value) !== Number(props.target.current));
const updated = computed(() => {
    const when = formatWhen(props.target.updatedAt, locale.value);
    return props.target.updatedBy && when ? t("Goals.updated_by", { name: personOf(props.target.updatedBy).name, when }) : "";
});

const showStored = () => { draft.value = text(props.target.current); };
const resetDraft = () => { showStored(); error.value = ""; };
watch(() => props.target.current, showStored);

async function setValue(value) {
    error.value = "";
    const result = await write("setValue", { id: props.goal._id, target: props.target, value });
    if (!result.ok && result.message) error.value = result.message;
}

function saveValue() {
    if (!dirty.value || !Number.isFinite(Number(draft.value)) || props.target.saving) return;
    setValue(draft.value);
}

const saveFlag = (done) => setValue(done);

async function stopEditing() {
    editing.value = false;
    refusal.value = null;
    await nextTick();
    editButton.value?.focus();
}

async function saveEdit(form) {
    busy.value = true;
    const result = await write("editTarget", { id: props.goal._id, target: props.target, form });
    busy.value = false;
    if (result.ok) stopEditing();
    else refusal.value = { field: result.field, message: result.message };
}

async function askRemove() {
    removing.value = true;
    await nextTick();
    keepButton.value?.focus();
}

async function stopRemoving() {
    removing.value = false;
    await nextTick();
    removeButton.value?.focus();
}

async function remove() {
    busy.value = true;
    const result = await write("removeTarget", { id: props.goal._id, targetId: props.target.id });
    busy.value = false;
    if (!result.ok) stopRemoving();
}
</script>
