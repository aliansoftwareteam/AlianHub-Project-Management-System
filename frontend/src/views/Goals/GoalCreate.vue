<template>
    <form class="ah-card glc" data-test="gls-create" :aria-label="$t('Goals.new_goal')" novalidate @submit.prevent="save" @keydown.esc.stop="$emit('cancel')">
        <label class="ah-field glc__name">
            <span class="ah-field__label">{{ $t('Goals.name') }}</span>
            <input
                ref="nameInput"
                v-model="form.name"
                type="text"
                class="ah-input"
                :class="{ 'ah-input--error': errors.name }"
                :maxlength="LIMITS.name"
                :placeholder="$t('Goals.name_placeholder')"
                :aria-invalid="errors.name ? 'true' : null"
                :aria-describedby="errors.name ? `${uid}-name` : null"
                data-test="gls-create-name"
                @input="errors.name = ''"
            />
            <span v-if="errors.name" :id="`${uid}-name`" class="ah-field__error" role="alert" data-error-for="name">{{ errors.name }}</span>
        </label>
        <label class="ah-field">
            <span class="ah-field__label">{{ $t('Goals.period_start') }}</span>
            <input
                v-model="form.periodStart"
                type="date"
                class="ah-input"
                :class="{ 'ah-input--error': errors.periodStart }"
                :aria-invalid="errors.periodStart ? 'true' : null"
                :aria-describedby="errors.periodStart ? `${uid}-start` : null"
                data-test="gls-create-start"
                @input="errors.periodStart = ''"
            />
            <span v-if="errors.periodStart" :id="`${uid}-start`" class="ah-field__error" role="alert" data-error-for="periodStart">{{ errors.periodStart }}</span>
        </label>
        <label class="ah-field">
            <span class="ah-field__label">{{ $t('Goals.period_end') }}</span>
            <input
                v-model="form.periodEnd"
                type="date"
                class="ah-input"
                :class="{ 'ah-input--error': errors.periodEnd }"
                :min="form.periodStart || null"
                :aria-invalid="errors.periodEnd ? 'true' : null"
                :aria-describedby="errors.periodEnd ? `${uid}-end` : null"
                data-test="gls-create-end"
                @input="errors.periodEnd = ''"
            />
            <span v-if="errors.periodEnd" :id="`${uid}-end`" class="ah-field__error" role="alert" data-error-for="periodEnd">{{ errors.periodEnd }}</span>
        </label>
        <p class="glc__note">
            <ShellIcon name="lock" :size="13" />
            <span>{{ $t('Goals.effect_private') }}</span>
        </p>
        <p v-if="errors.form" class="ah-field__error glc__error" role="alert" data-error-for="form">{{ errors.form }}</p>
        <div class="glc__actions">
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="gls-create-cancel" @click="$emit('cancel')">{{ $t('Goals.cancel') }}</button>
            <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" data-test="gls-create-save" :disabled="busy">{{ $t(busy ? 'Goals.saving' : 'Goals.save') }}</button>
        </div>
    </form>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { LIMITS, checkGoal } from "./goalRequest";
import { useGoalWrite } from "./useGoalWrite";

defineOptions({ name: "GoalCreate" });

const FIELDS = ["name", "periodStart", "periodEnd"];
/* The server reports the cap on goals a person may own as a refusal of the name. */
const SERVER_MESSAGES = { name: "Goals.error_name_server" };

const emit = defineEmits(["created", "cancel"]);

const { t } = useI18n();
const { write } = useGoalWrite();
const uid = `glc-${Math.random().toString(36).slice(2, 8)}`;

const nameInput = ref(null);
const busy = ref(false);
const form = reactive({ name: "", periodStart: "", periodEnd: "" });
const errors = reactive({ name: "", periodStart: "", periodEnd: "", form: "" });

function show(found) {
    FIELDS.forEach((field) => { errors[field] = found[field] || ""; });
    errors.form = found.form || "";
}

async function save() {
    const found = Object.fromEntries(Object.entries(checkGoal(form)).map(([field, key]) => [field, t(key)]));
    show(found);
    if (Object.keys(found).length || busy.value) return;
    busy.value = true;
    const result = await write("create", { ...form }, { messages: SERVER_MESSAGES });
    busy.value = false;
    if (result.ok) emit("created", result.goal);
    else if (result.message) show({ [FIELDS.includes(result.field) ? result.field : "form"]: result.message });
}

onMounted(() => nameInput.value?.focus());
</script>
