import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { AGENT_WORK_GROUP } from '@viewSettings';
import { useProjectCustomFields } from './projectCustomFields';
import { customGroupOptions } from './customFieldQuery';

const BY_STATUS = 0;
const BUILT_IN = Object.freeze([
    { id: BY_STATUS, label: 'status' },
    { id: 1, label: 'assignee' },
    { id: 2, label: 'priority' },
    { id: 3, label: 'due_date' },
]);

/* The project is named because the project page provides it to its children and so cannot inject it itself.
 * "Who is working" asks for no app: a connected agent works in a project whatever is switched on in it, and its
 * mark and filter are shown the same way. */
export function useGroupByOptions(project) {
    const { t } = useI18n();
    const { defs } = useProjectCustomFields(project);

    const options = computed(() => [
        ...BUILT_IN,
        { id: AGENT_WORK_GROUP, title: t('AgentWork.group'), icon: 'ai' },
        ...customGroupOptions(defs.value),
    ]);

    /* A view saved on a field that was deleted, or that this person cannot see, groups by status. */
    const shown = (groupBy) => (options.value.some((option) => option.id === groupBy) ? groupBy : BY_STATUS);

    return { options, shown };
}
