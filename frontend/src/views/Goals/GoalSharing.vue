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
        <span v-if="error && !dropping" class="ah-field__error" role="alert" :data-error-for="errorField">{{ error }}</span>
        <p class="glv__effect" role="status" data-test="glp-vis-effect">{{ effect }}</p>
        <div v-if="dropping" class="glv__drop" role="alert" data-test="glp-vis-drop">
            <span class="ah-field__error" :data-error-for="errorField">{{ error }}</span>
            <GoalSourceChips :sources="dropping" />
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="glp-vis-drop-save" :disabled="busy" @click="saveWithout">{{ $t('Goals.drop_sources_save') }}</button>
        </div>
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
import GoalSourceChips from "./GoalSourceChips.vue";
import { TASKS, VISIBILITIES, sourceCount, sourcesOf, withoutSources } from "./goalRequest";
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
/* The lists and tasks that the people this draft adds could not all open: the server will not let a
   goal count them, so the person is offered the save without them. */
const dropping = ref(null);

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

function forget() {
    error.value = "";
    dropping.value = null;
}

function reset() {
    Object.assign(draft, stored());
    forget();
}

function refuse(result) {
    if (!result.message) return;
    error.value = result.message;
    errorField.value = result.field;
    dropping.value = result.code === "sources_would_drop" && sourceCount(result.sources) ? sourcesOf(result.sources) : null;
}

async function save() {
    if (busy.value) return;
    busy.value = true;
    forget();
    const changes = { visibility: draft.visibility, ...(draft.visibility === "people" ? { sharedWith: [...draft.sharedWith] } : {}) };
    const result = await write("update", { id: props.goal._id, changes });
    busy.value = false;
    if (!result.ok) refuse(result);
}

async function saveWithout() {
    if (busy.value) return;
    const dropped = dropping.value;
    const holders = props.goal.targets.filter((target) => target.kind === TASKS && sourceCount(withoutSources(target.sources, dropped)) < sourceCount(target.sources));
    busy.value = true;
    for (const target of holders) {
        const result = await write("setSources", { id: props.goal._id, target, sources: withoutSources(target.sources, dropped) });
        if (!result.ok) {
            busy.value = false;
            if (result.message) error.value = result.message;
            return;
        }
    }
    busy.value = false;
    await save();
}

/* One string, so the draft is dropped only when the stored sharing changes: a goal is replaced whole
   on every answer, and an array made here would differ each time. */
watch(() => `${props.goal.visibility}|${(props.goal.sharedWith || []).join(",")}`, reset);
watch(() => [draft.visibility, draft.sharedWith.length], forget);
</script>
