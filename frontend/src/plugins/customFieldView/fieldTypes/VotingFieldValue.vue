<template>
    <span class="ftv" :class="{ 'ftv--compact': compact }">
        <button
            type="button"
            class="ftv__btn"
            :class="{ 'is-on': voted }"
            data-vote
            :aria-pressed="voted ? 'true' : 'false'"
            :aria-label="buttonLabel"
            :title="buttonLabel"
            :disabled="busy || !task?._id"
            @click.stop="toggle"
        >
            <ShellIcon name="upvote" :size="14" class="ftv__icon" />
            <span class="ftv__count">{{ count }}</span>
        </button>
        <span v-if="!compact && voters.length" class="ftv__voters" role="group" :aria-label="$t('FieldTypes.voting_voters')">
            <span v-for="voter in voters" :key="voter.id" class="ah-avatar ah-avatar--sm" data-voter :title="voter.name">
                <img v-if="voter.image" :src="voter.image" alt="" />
                <template v-else>{{ voter.initial }}</template>
            </span>
        </span>
    </span>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest } from "@/services";
import { useGetterFunctions } from "@/composable";
import { countOf, tallyOf } from "@fieldTypes/voting";
import { linkedValue, reloadLinks } from "./fieldLinks";

defineOptions({ name: "VotingFieldValue" });

/* `editable` is taken and not read: a vote needs the right to open the task, not the right to edit its fields. */
const props = defineProps({
    def: { type: Object, required: true },
    value: { type: [Number, String, Array], default: null },
    task: { type: Object, default: () => ({}) },
    editable: { type: Boolean, default: false },
    compact: { type: Boolean, default: false },
    label: { type: String, default: "" }
});

const { t } = useI18n();
const $toast = useToast();
const { getUser } = useGetterFunctions();

const busy = ref(false);
/* What the server answered to this person's own vote, shown until the task's marker for the field moves. */
const cast = ref(null);

const revision = computed(() => props.task?.customField?.[props.def._id]?.revision);
const stored = computed(() => countOf(props.value));
/* No votes is no value on the task, whatever was answered before the last vote was withdrawn. */
const tally = computed(() => tallyOf(stored.value ? linkedValue(props.task, props.def._id) : null));
const count = computed(() => (cast.value ? cast.value.count : stored.value));
const voted = computed(() => (cast.value ? cast.value.voted : tally.value.voted));
const voters = computed(() => (count.value ? tally.value.voters : []).map((id) => {
    const user = getUser(id);
    const name = user.Employee_Name || "";
    return { id, name, image: user.Employee_profileImageURL || "", initial: (name.trim().charAt(0) || "?").toUpperCase() };
}));
const buttonLabel = computed(() => t(voted.value ? "FieldTypes.voting_withdraw" : "FieldTypes.voting_vote", { field: props.label, n: count.value }));

watch([revision, stored], () => { cast.value = null; });

async function toggle() {
    if (busy.value || !props.task?._id) return;
    busy.value = true;
    try {
        const response = await apiRequest("post", `/api/v2/custom-fields/${props.def._id}/vote`, { taskId: props.task._id, vote: !voted.value });
        if (response?.data?.status !== true) throw new Error("vote refused");
        cast.value = { count: countOf(response.data.data?.count), voted: response.data.data?.voted === true };
        reloadLinks(props.task);
    } catch (error) {
        $toast.error(error?.response?.data?.statusText || t("FieldTypes.voting_failed"), { position: "top-right" });
    } finally {
        busy.value = false;
    }
}
</script>

<style>
.ftv { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; max-width: 100%; }
.ftv__btn {
    display: inline-flex; align-items: center; gap: 4px;
    min-width: 24px; min-height: 24px; padding: 0 8px;
    border: 1px solid var(--border); border-radius: 999px;
    background: var(--surface); color: var(--ink-2); font: var(--text-data); cursor: pointer;
}
.ftv__btn:hover { background: var(--surface-hover); color: var(--ink); }
.ftv__btn:focus-visible { outline: none; box-shadow: var(--focus); }
.ftv__btn:disabled { cursor: progress; }
.ftv__btn.is-on { border-color: var(--brand); background: var(--brand-tint); color: var(--ink); }
.ftv__btn.is-on .ftv__icon { fill: currentColor; }
.ftv__icon { flex: none; }
.ftv__voters { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; min-width: 0; }
@media (max-width: 767px) {
    .ftv__btn { min-height: 32px; padding: 0 12px; }
}
</style>
