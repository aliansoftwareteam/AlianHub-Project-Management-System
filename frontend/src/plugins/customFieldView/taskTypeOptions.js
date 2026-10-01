import { computed, unref } from 'vue';
import { useStore } from 'vuex';
import { fieldTaskTypes } from '@fieldTaskTypes';

/* Task type keys are numbered company-wide by the task type settings, so one list serves every project a field can show on. */
export function taskTypeOptions(companyTypes, templates, chosen = []) {
    const byKey = new Map();
    const add = (type) => {
        const key = Number(type?.key);
        if (!Number.isInteger(key) || type?.isDeleted || byKey.has(key)) return;
        byKey.set(key, { key, name: type.name || type.value || String(key), taskType: type });
    };
    const settings = Array.isArray(companyTypes?.settings) ? companyTypes.settings : [];
    settings.forEach(add);
    if (!byKey.size) (templates || []).forEach((template) => (template?.taskTypes || []).forEach(add));
    fieldTaskTypes({ fieldTaskTypes: chosen }).forEach((key) => {
        if (!byKey.has(key)) byKey.set(key, { key, name: '', missing: true, taskType: null });
    });
    return [...byKey.values()];
}

export function useTaskTypeOptions(chosenRef = []) {
    const { getters } = useStore();
    return computed(() => taskTypeOptions(getters['settings/AllTaskType'], getters['settings/taskType'], unref(chosenRef)));
}
