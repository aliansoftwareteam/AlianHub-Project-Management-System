import { ref, nextTick } from 'vue';
import { useStore } from 'vuex';
import { useCustomComposable } from '@/composable';

export function useProjectRules() {
    const { getters, dispatch } = useStore();
    const { checkPermission } = useCustomComposable();

    const isRuleData = ref(false);
    const rulePermission = ref(true);

    function getProjectRule(data) {
        if (data.isGlobalPermission !== false) return;

        isRuleData.value = true;

        const finalize = () => {
            nextTick(() => {
                isRuleData.value = false;
                rulePermission.value = checkPermission('project.project_list', data.isGlobalPermission, { gettersVal: getters });
            });
        };

        const rawRules = getters['settings/projectRawRules'];

        if (rawRules && rawRules.length > 0) {
            if (rawRules.some((x) => x.projectId !== data._id)) {
                dispatch('settings/setProjectRules', { pid: data._id })
                    .then(finalize)
                    .catch(finalize);
            } else {
                finalize();
            }
        } else {
            dispatch('settings/setProjectRules', { pid: data._id })
                .then(finalize)
                .catch(finalize);
        }
    }

    return {
        isRuleData,
        rulePermission,
        getProjectRule,
    };
}
