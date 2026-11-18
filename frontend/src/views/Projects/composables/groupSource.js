import { computed, watch } from 'vue';
import { useStore } from 'vuex';
import { AGENT_WORK_GROUP } from '@viewSettings';
import { customFieldIdOf } from './customFieldQuery';
import { agentWorkIn } from './agentWork';

const BY_STATUS = 0;

/* What a task view builds its groups from: the project's statuses, the field it is grouped by, or the agents at
 * work in the project. The project in the store is replaced whenever it is read again (a fetch, or
 * `projectChanged` in liveProjects.js), an agent takes a task or lets it go, and a view builds its groups once,
 * so it has to be told when what it built them from is no longer what holds. */
export function groupSourceOf(grouped, project, fields) {
    if (grouped === BY_STATUS) return JSON.stringify(project?.taskStatusData || []);
    if (grouped === AGENT_WORK_GROUP) return JSON.stringify(agentWorkIn(project?._id));
    const fieldId = customFieldIdOf(grouped);
    if (!fieldId) return '';
    return JSON.stringify((fields || []).find((field) => String(field?._id) === fieldId) || null);
}

/* Another project or another grouping is a different view, which each view already rebuilds for. */
export function useGroupSource(project, grouped, rebuild) {
    const { getters } = useStore();
    const source = computed(() => groupSourceOf(grouped(), project.value, getters['settings/finalCustomFields']));
    watch(() => [String(project.value?._id || ''), String(grouped()), source.value], ([id, group, now], [oldId, oldGroup, before]) => {
        if (id && id === oldId && group === oldGroup && now !== before) rebuild();
    });
    return source;
}
