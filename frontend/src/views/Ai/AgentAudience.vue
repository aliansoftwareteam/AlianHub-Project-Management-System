<template>
    <div class="ah-field agau" data-test="agent-audience">
        <span class="ah-field__label">{{ $t('AgentAccess.who_can_use') }}</span>
        <div class="ai-radios">
            <label v-for="option in OPTIONS" :key="option" class="ai-radio" :class="{ 'is-on': visibility === option }">
                <input type="radio" class="ah-check" :value="option" :checked="visibility === option" :disabled="disabled" :data-test="`audience-${option}`" @change="setVisibility(option)" />
                <span class="aw__level"><strong>{{ $t(`AgentAccess.visibility_${option}`) }}</strong><span class="ah-small">{{ $t(`AgentAccess.visibility_${option}_about`) }}</span></span>
            </label>
        </div>
        <div v-if="visibility === 'shared'" class="agau__shared">
            <input v-model.trim="query" type="search" class="ah-input" :placeholder="$t('AgentAccess.find_people_teams')" :aria-label="$t('AgentAccess.find_people_teams')" :disabled="disabled" />
            <div class="agau__lists">
                <div class="agau__list">
                    <span class="ah-label">{{ $t('AgentAccess.teams') }}</span>
                    <label v-for="team in shownTeams" :key="team.id" class="agau__item">
                        <input type="checkbox" class="ah-check" :checked="shared.teamIds.includes(team.id)" :disabled="disabled" @change="toggle('teamIds', team.id)" />
                        <span>{{ team.name }}</span>
                    </label>
                    <span v-if="!shownTeams.length" class="ah-small agau__none">{{ $t('AgentAccess.no_teams') }}</span>
                </div>
                <div class="agau__list">
                    <span class="ah-label">{{ $t('AgentAccess.people') }}</span>
                    <label v-for="person in shownPeople" :key="person.id" class="agau__item">
                        <input type="checkbox" class="ah-check" :checked="shared.userIds.includes(person.id)" :disabled="disabled" @change="toggle('userIds', person.id)" />
                        <span>{{ person.name }}</span>
                    </label>
                    <span v-if="!shownPeople.length" class="ah-small agau__none">{{ $t('AgentAccess.no_people') }}</span>
                </div>
            </div>
            <span v-if="!shared.userIds.length && !shared.teamIds.length" class="ah-field__hint">{{ $t('AgentAccess.choose_someone') }}</span>
        </div>
        <span v-if="hint" class="ah-field__hint">{{ hint }}</span>
    </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { useStore } from "vuex";

defineOptions({ name: "AgentAudience" });

const props = defineProps({
    visibility: { type: String, default: "private" },
    sharedWith: { type: Object, default: () => ({ userIds: [], teamIds: [] }) },
    disabled: { type: Boolean, default: false },
    hint: { type: String, default: "" },
});
const emit = defineEmits(["update:visibility", "update:sharedWith"]);

const OPTIONS = ["private", "shared", "everyone"];
const ACTIVE_SEAT = 2;

const { getters } = useStore();
const query = ref("");

const shared = computed(() => ({ userIds: [...(props.sharedWith?.userIds || [])].map(String), teamIds: [...(props.sharedWith?.teamIds || [])].map(String) }));

const people = computed(() => {
    const seated = new Set((getters["settings/companyUsers"] || []).filter((seat) => Number(seat.status) === ACTIVE_SEAT && seat.isDelete !== true).map((seat) => String(seat.userId)));
    return (getters["users/users"] || [])
        .filter((user) => seated.has(String(user._id)))
        .map((user) => ({ id: String(user._id), name: user.Employee_Name || [user.Employee_FName, user.Employee_LName].filter(Boolean).join(" ") || user.Employee_Email || "" }))
        .sort((a, b) => a.name.localeCompare(b.name));
});
const teams = computed(() => (getters["settings/teams"] || []).map((team) => ({ id: String(team._id), name: team.name || "" })));

const matches = (name) => !query.value || name.toLowerCase().includes(query.value.toLowerCase());
const shownPeople = computed(() => people.value.filter((person) => matches(person.name) || shared.value.userIds.includes(person.id)));
const shownTeams = computed(() => teams.value.filter((team) => matches(team.name) || shared.value.teamIds.includes(team.id)));

const setVisibility = (option) => {
    emit("update:visibility", option);
    if (option !== "shared") emit("update:sharedWith", { userIds: [], teamIds: [] });
};

const toggle = (field, id) => {
    const next = { ...shared.value };
    next[field] = next[field].includes(id) ? next[field].filter((x) => x !== id) : [...next[field], id];
    emit("update:sharedWith", next);
};
</script>

<style>
.agau__shared { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.agau__lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.agau__list { display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow: auto; padding: 8px; border: 1px solid var(--hairline); border-radius: 9px; }
.agau__item { display: flex; align-items: center; gap: 8px; font: var(--text-small); color: var(--ink); cursor: pointer; }
.agau__none { color: var(--ink-2); }
</style>
