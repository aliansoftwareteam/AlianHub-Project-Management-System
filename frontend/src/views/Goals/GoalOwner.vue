<template>
    <div class="glo">
        <div class="glo__now">
            <span class="ah-avatar ah-avatar--sm" aria-hidden="true">
                <img v-if="owner.image" :src="owner.image" alt="" />
                <template v-else>{{ owner.initial }}</template>
            </span>
            <span class="glo__name" data-test="glp-owner">{{ owner.name }}</span>
            <button v-if="editable && !changing" ref="changeButton" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="glp-owner-change" @click="start">
                {{ $t('Goals.change_owner') }}
            </button>
        </div>
        <div v-if="changing" class="glo__change" @keydown.esc.stop="stop">
            <label class="ah-field">
                <span class="ah-field__label">{{ $t('Goals.new_owner') }}</span>
                <select
                    ref="pick"
                    v-model="nextId"
                    class="ah-input glo__pick"
                    :class="{ 'ah-input--error': error }"
                    :aria-invalid="error ? 'true' : null"
                    :aria-describedby="`${uid}-effect`"
                    data-test="glp-owner-pick"
                    @change="error = ''"
                >
                    <option value="">{{ $t('Goals.owner_pick') }}</option>
                    <option v-for="person in candidates" :key="person.id" :value="person.id">{{ person.name }}</option>
                </select>
            </label>
            <span v-if="error" class="ah-field__error" role="alert" data-error-for="ownerUserId">{{ error }}</span>
            <p :id="`${uid}-effect`" class="glo__effect" role="status">
                <span v-if="next" data-test="glp-owner-effect">{{ $t('Goals.owner_confirm', { name: next.name }) }} {{ effect }}</span>
            </p>
            <div class="glo__actions">
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="glp-owner-cancel" @click="stop">{{ $t('Goals.cancel') }}</button>
                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="glp-owner-confirm" :disabled="!next || busy" @click="confirm">{{ $t('Goals.change_owner') }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { afterHandover } from "./goalRequest";
import { useGoalPeople } from "./useGoalPeople";
import { useGoalWrite } from "./useGoalWrite";

defineOptions({ name: "GoalOwner" });

const props = defineProps({
    goal: { type: Object, required: true },
    editable: { type: Boolean, default: false }
});

const { t } = useI18n();
const { personOf, members, isPrivileged } = useGoalPeople();
const { write } = useGoalWrite();
const userId = inject("$userId", ref(""));
const uid = `glo-${Math.random().toString(36).slice(2, 8)}`;

const changing = ref(false);
const nextId = ref("");
const busy = ref(false);
const error = ref("");
const pick = ref(null);
const changeButton = ref(null);

const owner = computed(() => personOf(props.goal.ownerUserId));
const candidates = computed(() => members.value.filter((person) => !person.guest && person.id !== String(props.goal.ownerUserId)));
const next = computed(() => candidates.value.find((person) => person.id === nextId.value) || null);

const effect = computed(() => {
    const me = String(userId.value || "");
    if (nextId.value === me) return t("Goals.owner_effect_keep");
    const left = afterHandover(props.goal, { myId: me, privileged: isPrivileged.value });
    if (!left.sees) return t("Goals.owner_effect_sight");
    return t(left.edits ? "Goals.owner_effect_keep" : "Goals.owner_effect_edit");
});

async function start() {
    changing.value = true;
    nextId.value = "";
    error.value = "";
    await nextTick();
    pick.value?.focus();
}

async function stop() {
    changing.value = false;
    await nextTick();
    changeButton.value?.focus();
}

async function confirm() {
    if (!next.value || busy.value) return;
    busy.value = true;
    const result = await write("update", { id: props.goal._id, changes: { ownerUserId: next.value.id } });
    busy.value = false;
    if (result.ok) changing.value = false;
    else if (result.message) error.value = result.message;
}
</script>
