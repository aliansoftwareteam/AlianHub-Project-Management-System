<template>
    <section class="cv-panel" data-test="org-chart">
        <h2 class="ah-h3">{{ $t('CompanyView.org_title') }}</h2>
        <div v-if="loading" class="ah-empty">{{ $t('CompanyView.loading') }}</div>
        <EmptyState v-else-if="failed" :title="$t('CompanyView.load_failed')" :action-label="$t('CompanyView.retry')" @action="$emit('retry')" />
        <p v-else-if="!blueprints.length" class="ah-small" data-test="org-empty">{{ $t('CompanyView.org_empty') }}</p>
        <template v-else>
            <div v-for="group in blueprints" :key="group.blueprint" class="cv-blueprint" :data-blueprint="group.blueprint">
                <div class="ah-label">{{ blueprintLabel(group.blueprint) }}</div>
                <div class="cv-teams">
                    <div v-for="team in group.teams" :key="team.team" class="ah-card cv-team" :data-team="team.team">
                        <div class="cv-team__name">{{ team.team }}</div>
                        <ul class="cv-roles">
                            <li v-for="role in team.roles" :key="role.key" class="cv-role" :data-role="role.key">
                                <div class="cv-role__top">
                                    <strong class="cv-role__name">{{ role.name }}</strong>
                                    <span class="ah-chip">{{ $t('CompanyView.org_projects', { n: role.projects.length }, role.projects.length) }}</span>
                                </div>
                                <div class="cv-role__line ah-small">
                                    <span v-if="!role.agents.length">{{ $t('CompanyView.org_no_agents') }}</span>
                                    <template v-else>
                                        <span class="ah-label">{{ $t('CompanyView.org_agents_label') }}</span>
                                        <span v-for="agent in role.agents" :key="agent.id" class="cv-agent">
                                            {{ agent.name }}<span v-if="agent.paused" class="ah-chip ah-chip--warn">{{ $t('CompanyView.org_paused') }}</span>
                                        </span>
                                    </template>
                                </div>
                                <div class="cv-role__line ah-small" data-test="supervisor">
                                    <span v-if="!role.supervisors.length">{{ $t('CompanyView.org_no_supervisor') }}</span>
                                    <span v-for="person in role.supervisors" :key="person.id">
                                        {{ $t(person.via === 'agent' ? 'CompanyView.org_supervised_by' : 'CompanyView.org_set_up_by', { name: person.name || $t('CompanyView.org_unknown_person') }) }}
                                    </span>
                                </div>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </template>
    </section>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import { blueprintName } from "@/utils/dispatcher";

defineOptions({ name: "CompanyOrgChart" });

const props = defineProps({
    data: { type: Object, default: null },
    loading: { type: Boolean, default: false },
    failed: { type: Boolean, default: false }
});
defineEmits(["retry"]);

const { t, te } = useI18n();
const blueprints = computed(() => props.data?.blueprints || []);
const blueprintLabel = (blueprint) => blueprintName(t, te, blueprint);
</script>
