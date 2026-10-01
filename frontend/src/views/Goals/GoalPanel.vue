<template>
    <aside ref="root" class="glp" data-test="glp" tabindex="-1" :aria-label="$t('Goals.details')" @keydown.esc="$emit('close')">
        <header class="glp__head">
            <label v-if="editable" class="glp__name-field">
                <span class="ah-sr-only">{{ $t('Goals.name') }}</span>
                <input
                    ref="nameInput"
                    v-model="name"
                    type="text"
                    class="ah-input glp__name"
                    :class="{ 'ah-input--error': errors.name }"
                    :maxlength="LIMITS.name"
                    :aria-invalid="errors.name ? 'true' : null"
                    :aria-describedby="errors.name ? `${uid}-name` : null"
                    data-test="glp-name"
                    @input="errors.name = ''"
                    @blur="saveText('name')"
                    @keydown.enter.prevent="$event.target.blur()"
                    @keydown.esc.stop="resetText('name')"
                />
            </label>
            <h2 v-else-if="goal" class="glp__title" data-test="glp-name-text">{{ goal.name }}</h2>
            <h2 v-else class="glp__title">{{ $t('Goals.details') }}</h2>
            <button type="button" class="glp__close" data-test="glp-close" :aria-label="$t('Goals.close')" :title="$t('Goals.close')" @click="$emit('close')">
                <ShellIcon name="x" :size="16" />
            </button>
        </header>
        <span v-if="errors.name" :id="`${uid}-name`" class="ah-field__error glp__head-error" role="alert" data-error-for="name">{{ errors.name }}</span>

        <div v-if="state.status === 'loading'" class="glp__skeleton" role="status" :aria-label="$t('Goals.loading')" data-test="glp-loading">
            <span v-for="n in 5" :key="n" class="gls__skeleton-row"></span>
        </div>
        <div v-else-if="state.status === 'missing'" class="ah-empty glp__state" data-test="glp-missing">
            <strong>{{ $t('Goals.goal_missing_title') }}</strong>
            <span>{{ $t('Goals.goal_missing_hint') }}</span>
        </div>
        <div v-else-if="!goal" class="ah-empty glp__state" role="alert" data-test="glp-failed">
            <strong>{{ $t('Goals.goal_failed') }}</strong>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="glp-retry" @click="$emit('retry')">{{ $t('Goals.retry') }}</button>
        </div>

        <div v-else class="glp__body ah-scroll">
            <p v-if="goal.archived" class="glp__note" data-test="glp-archived">
                <span>{{ $t(goal.canEdit ? 'Goals.archived_note' : 'Goals.archived_note_reader') }}</span>
                <button v-if="goal.canEdit" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="glp-restore" :disabled="busy" @click="setArchived(false)">{{ $t('Goals.restore') }}</button>
            </p>

            <div class="glp__progress">
                <GoalBar :value="goal.progressPct" :label="$t('Goals.progress_of', { name: goal.name })" />
                <span class="glp__pct">{{ goal.progressPct }}%</span>
                <span class="glp__reached">{{ reached }}</span>
            </div>

            <label v-if="editable" class="ah-field">
                <span class="ah-field__label">{{ $t('Goals.description') }}</span>
                <textarea
                    ref="descriptionInput"
                    v-model="description"
                    class="ah-input ah-textarea glp__description"
                    :class="{ 'ah-input--error': errors.description }"
                    :maxlength="LIMITS.description"
                    :placeholder="$t('Goals.description_placeholder')"
                    :aria-invalid="errors.description ? 'true' : null"
                    :aria-describedby="errors.description ? `${uid}-description` : null"
                    data-test="glp-description"
                    @input="errors.description = ''"
                    @blur="saveText('description')"
                    @keydown.esc.stop="resetText('description')"
                ></textarea>
                <span v-if="errors.description" :id="`${uid}-description`" class="ah-field__error" role="alert" data-error-for="description">{{ errors.description }}</span>
            </label>
            <p v-else-if="goal.description" class="glp__text">{{ goal.description }}</p>

            <section class="glp__section" :aria-label="$t('Goals.owner')">
                <h3 class="ah-field__label">{{ $t('Goals.owner') }}</h3>
                <GoalOwner :goal="goal" :editable="editable" />
            </section>

            <section class="glp__section" :aria-label="$t('Goals.period')">
                <template v-if="editable">
                    <div class="glp__dates">
                        <label class="ah-field">
                            <span class="ah-field__label">{{ $t('Goals.period_start') }}</span>
                            <input
                                type="date"
                                class="ah-input"
                                :class="{ 'ah-input--error': errors.periodStart }"
                                :value="goal.periodStart"
                                :aria-invalid="errors.periodStart ? 'true' : null"
                                :aria-describedby="errors.periodStart ? `${uid}-periodStart` : null"
                                data-test="glp-start"
                                @change="saveDay('periodStart', $event)"
                            />
                        </label>
                        <label class="ah-field">
                            <span class="ah-field__label">{{ $t('Goals.period_end') }}</span>
                            <input
                                type="date"
                                class="ah-input"
                                :class="{ 'ah-input--error': errors.periodEnd }"
                                :value="goal.periodEnd"
                                :aria-invalid="errors.periodEnd ? 'true' : null"
                                :aria-describedby="errors.periodEnd ? `${uid}-periodEnd` : null"
                                data-test="glp-end"
                                @change="saveDay('periodEnd', $event)"
                            />
                        </label>
                    </div>
                    <span v-if="errors.periodStart" :id="`${uid}-periodStart`" class="ah-field__error" role="alert" data-error-for="periodStart">{{ errors.periodStart }}</span>
                    <span v-if="errors.periodEnd" :id="`${uid}-periodEnd`" class="ah-field__error" role="alert" data-error-for="periodEnd">{{ errors.periodEnd }}</span>
                </template>
                <template v-else>
                    <h3 class="ah-field__label">{{ $t('Goals.period') }}</h3>
                    <p class="glp__text" data-test="glp-period-text">{{ period }}</p>
                </template>
            </section>

            <section class="glp__section" :aria-label="$t('Goals.visibility')">
                <GoalSharing v-if="editable" :goal="goal" />
                <template v-else>
                    <h3 class="ah-field__label">{{ $t('Goals.visibility') }}</h3>
                    <p class="glp__text" data-test="glp-vis-text">{{ visibility }}</p>
                </template>
            </section>

            <section v-if="editable" class="glp__section" :aria-label="$t('Goals.color')">
                <h3 :id="`${uid}-color`" class="ah-field__label">{{ $t('Goals.color') }}</h3>
                <div class="glp__colors" role="radiogroup" :aria-labelledby="`${uid}-color`">
                    <button
                        v-for="(color, index) in COLOR_CHOICES"
                        :key="color || 'none'"
                        type="button"
                        class="glp__color"
                        :class="{ 'is-none': !color }"
                        role="radio"
                        :aria-checked="sameColor(color) ? 'true' : 'false'"
                        :aria-label="color ? $t('Goals.color_pick', { n: index }) : $t('Goals.color_none')"
                        :title="color ? $t('Goals.color_pick', { n: index }) : $t('Goals.color_none')"
                        :style="color ? { background: color } : null"
                        data-test="glp-color"
                        @click="saveColor(color)"
                    >
                        <ShellIcon v-if="!color" name="x" :size="12" />
                    </button>
                </div>
                <span v-if="errors.color" class="ah-field__error" role="alert" data-error-for="color">{{ errors.color }}</span>
            </section>

            <section class="glp__section glp__targets" :aria-labelledby="`${uid}-targets`">
                <h3 :id="`${uid}-targets`" class="glp__heading">{{ $t('Goals.targets') }}</h3>
                <ul v-if="goal.targets.length" class="glp__target-list">
                    <GoalTarget v-for="target in goal.targets" :key="target.id" :goal="goal" :target="target" :currencies="currencies" />
                </ul>
                <p v-else class="glp__text">{{ $t('Goals.no_targets') }}</p>
                <template v-if="editable">
                    <GoalTargetForm v-if="adding" class="glp__add-form" :currencies="currencies" :busy="busy" :refusal="refusal" @save="addTarget" @cancel="stopAdding" />
                    <p v-else-if="goal.targets.length >= LIMITS.targets" class="glp__text">{{ $t('Goals.targets_full', { n: LIMITS.targets }) }}</p>
                    <button v-else ref="addButton" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="glp-add-target" @click="adding = true">
                        <ShellIcon name="plus" :size="13" />{{ $t('Goals.add_target') }}
                    </button>
                </template>
            </section>

            <footer v-if="editable" class="glp__foot">
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="glp-archive" :disabled="busy" @click="setArchived(true)">{{ $t('Goals.archive') }}</button>
            </footer>
        </div>
    </aside>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import GoalBar from "./GoalBar.vue";
import GoalOwner from "./GoalOwner.vue";
import GoalSharing from "./GoalSharing.vue";
import GoalTarget from "./GoalTarget.vue";
import GoalTargetForm from "./GoalTargetForm.vue";
import { GOAL_COLORS, periodLabel } from "./goalFormat";
import { LIMITS, checkGoal, reachedCount } from "./goalRequest";
import { useGoalWrite } from "./useGoalWrite";

defineOptions({ name: "GoalPanel" });

const COLOR_CHOICES = ["", ...GOAL_COLORS];
const CURRENCY_CODE = /^[A-Z]{3}$/;

const props = defineProps({
    state: { type: Object, required: true }
});
defineEmits(["close", "retry"]);

const store = useStore();
const { t, locale } = useI18n();
const { write } = useGoalWrite();
const uid = `glp-${Math.random().toString(36).slice(2, 8)}`;

const root = ref(null);
const nameInput = ref(null);
const descriptionInput = ref(null);
const addButton = ref(null);
const name = ref("");
const description = ref("");
const adding = ref(false);
const busy = ref(false);
const refusal = ref(null);
const errors = reactive({ name: "", description: "", periodStart: "", periodEnd: "", color: "" });

const goal = computed(() => props.state.goal);
/* An archived goal is restored before it is changed; the server refuses anything else. */
const editable = computed(() => Boolean(goal.value) && goal.value.canEdit === true && !goal.value.archived);
const period = computed(() => periodLabel(goal.value, t, locale.value));
const reached = computed(() => {
    const total = goal.value.targets.length;
    return total ? t("Goals.reached", { done: reachedCount(goal.value), total }) : t("Goals.no_targets");
});
const visibility = computed(() => (goal.value.sharedWithMe ? t("Goals.shared_with_you") : t(`Goals.visibility_${goal.value.visibility}`)));
const currencies = computed(() => [...new Map((store.getters["settings/allCurrencyArray"] || [])
    .filter((currency) => CURRENCY_CODE.test(currency?.code || ""))
    .map((currency) => [currency.code, { code: currency.code, label: currency.name ? `${currency.code} · ${currency.name}` : currency.code }])).values()]
    .sort((a, b) => a.code.localeCompare(b.code)));

const sameColor = (color) => String(goal.value.color || "").toLowerCase() === color.toLowerCase();

const local = { name, description };
const showStored = (field) => { local[field].value = goal.value?.[field] || ""; };
function resetText(field) {
    showStored(field);
    errors[field] = "";
}

async function change(field, value, { failed = () => {} } = {}) {
    const found = checkGoal({ periodStart: goal.value.periodStart, periodEnd: goal.value.periodEnd, [field]: value });
    const shown = Object.keys(found)[0];
    if (shown) {
        errors[shown] = t(found[shown]);
        return failed();
    }
    const result = await write("update", { id: goal.value._id, changes: { [field]: value } });
    if (result.ok) return undefined;
    if (result.message && result.field in errors) errors[result.field] = result.message;
    return failed();
}

function saveText(field) {
    const value = local[field].value.trim();
    if (value === (goal.value[field] || "")) return showStored(field);
    return change(field, value);
}

function saveDay(field, event) {
    errors.periodStart = "";
    errors.periodEnd = "";
    return change(field, event.target.value, { failed: () => { event.target.value = goal.value?.[field] || ""; } });
}

function saveColor(color) {
    errors.color = "";
    if (!sameColor(color)) change("color", color);
}

async function setArchived(archived) {
    busy.value = true;
    await write(archived ? "archive" : "restore", goal.value._id);
    busy.value = false;
}

async function stopAdding() {
    adding.value = false;
    refusal.value = null;
    await nextTick();
    addButton.value?.focus();
}

async function addTarget(form) {
    busy.value = true;
    const result = await write("addTarget", { id: goal.value._id, form });
    busy.value = false;
    if (result.ok) stopAdding();
    else refusal.value = result;
}

/* What the person is typing is theirs until they leave the field; a change from elsewhere fills the rest. */
const inputs = { name: nameInput, description: descriptionInput };
watch(() => [goal.value?.name, goal.value?.description], () => {
    Object.keys(local).forEach((field) => { if (document.activeElement !== inputs[field].value) showStored(field); });
}, { immediate: true });

onMounted(() => root.value?.focus());
</script>
