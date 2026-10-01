<template>
    <fieldset class="glv">
        <legend class="ah-field__label">{{ $t('Goals.visibility') }}</legend>
        <div class="glv__options">
            <label v-for="option in VISIBILITIES" :key="option" class="glv__option">
                <input v-model="draft.visibility" type="radio" class="ah-check" :name="`${uid}-visibility`" :value="option" :data-test="`glp-vis-${option}`" />
                <span>{{ $t(`Goals.visibility_${option}`) }}</span>
            </label>
        </div>
        <GoalPeoplePicker v-if="draft.visibility === 'people'" v-model="draft.sharedWith" :people="choices" />
        <span v-if="error" class="ah-field__error" role="alert" :data-error-for="errorField">{{ error }}</span>
        <p class="glv__effect" role="status" data-test="glp-vis-effect">{{ effect }}</p>
        <div v-if="dirty" class="glv__actions">
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="glp-vis-cancel" @click="reset">{{ $t('Goals.cancel') }}</button>
            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="glp-vis-save" :disabled="busy" @click="save">{{ $t(busy ? 'Goals.saving' : 'Goals.save') }}</button>
        </div>
    </fieldset>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import GoalPeoplePicker from "./GoalPeoplePicker.vue";
import { VISIBILITIES } from "./goalRequest";
import { useGoalPeople } from "./useGoalPeople";
import { useGoalWrite } from "./useGoalWrite";

defineOptions({ name: "GoalSharing" });

const props = defineProps({
    goal: { type: Object, required: true }
});

const { t } = useI18n();
const { personOf, members } = useGoalPeople();
const { write } = useGoalWrite();
const uid = `glv-${Math.random().toString(36).slice(2, 8)}`;

const stored = () => ({ visibility: props.goal.visibility, sharedWith: [...(props.goal.sharedWith || [])] });
const draft = reactive(stored());
const busy = ref(false);
const error = ref("");
const errorField = ref("");

const sameList = (a, b) => a.length === b.length && a.every((id) => b.includes(id));
const sharingChanged = computed(() => draft.visibility === "people" && !sameList(draft.sharedWith, props.goal.sharedWith || []));
const dirty = computed(() => draft.visibility !== props.goal.visibility || sharingChanged.value);

const choices = computed(() => members.value.filter((person) => person.id !== String(props.goal.ownerUserId)));
const ownerName = computed(() => personOf(props.goal.ownerUserId).name);

/* Said before saving. An admin who narrows someone else's goal takes it out of their own reach. */
const effect = computed(() => {
    const mine = props.goal.isOwner;
    const n = draft.sharedWith.length;
    if (draft.visibility === "workspace") return t("Goals.effect_workspace");
    if (draft.visibility === "private") return mine ? t("Goals.effect_private") : t("Goals.effect_private_other", { name: ownerName.value });
    if (!mine) return t("Goals.effect_people_other", { name: ownerName.value, n }, n);
    return n ? t("Goals.effect_people", { n }, n) : t("Goals.effect_people_none");
});

function reset() {
    Object.assign(draft, stored());
    error.value = "";
}

async function save() {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    const changes = { visibility: draft.visibility, ...(draft.visibility === "people" ? { sharedWith: [...draft.sharedWith] } : {}) };
    const result = await write("update", { id: props.goal._id, changes });
    busy.value = false;
    if (!result.ok && result.message) {
        error.value = result.message;
        errorField.value = result.field;
    }
}

watch(() => [props.goal.visibility, (props.goal.sharedWith || []).join(",")], reset);
watch(() => [draft.visibility, draft.sharedWith.length], () => { error.value = ""; });
</script>
