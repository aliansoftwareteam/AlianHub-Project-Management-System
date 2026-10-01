import { computed, inject, unref } from 'vue';
import { useStore } from 'vuex';
import { fieldTaskTypes } from '@fieldTaskTypes';

const listOf = (value) => (Array.isArray(value) ? value : []);
/* The key reader the server saves with, so every option is a key it accepts. */
const keyOf = (type) => fieldTaskTypes({ fieldTaskTypes: [type?.key] })[0];
const liveTypes = (types) => listOf(types).filter((type) => keyOf(type) && !type.isDeleted);
const typesOf = (projects) => projects.flatMap((project) => listOf(project?.taskTypeCounts));

/* The server reads a field with no project as company-wide (isCompanyWide in fieldWrite.js), so the picker does too. */
export const fieldProjectIds = (field) => (field?.global === true ? [] : [].concat(field?.projectId || []).filter(Boolean).map(String));

/*
 * A project carries its own task types in taskTypeCounts, and a task stores one of those keys as TaskTypeKey.
 * Keys are numbered company-wide, so the types of several projects merge by key.
 */
export function taskTypeOptions({ companyTypes, templates, projects, projectIds, chosen } = {}) {
    const ids = [].concat(projectIds || []).filter(Boolean).map(String);
    const known = listOf(projects).filter(Boolean);
    const ownProjects = known.filter((project) => ids.includes(String(project._id)));
    const sources = [
        ...(ids.length ? [typesOf(ownProjects)] : []),
        companyTypes?.settings,
        ...(ids.length ? [] : [typesOf(known)]),
        listOf(templates).flatMap((template) => listOf(template?.taskTypes))
    ];
    const byKey = new Map();
    (sources.map(liveTypes).find((types) => types.length) || []).forEach((type) => {
        const key = keyOf(type);
        if (!byKey.has(key)) byKey.set(key, { key, name: type.name || type.value || String(key), taskType: type });
    });
    fieldTaskTypes({ fieldTaskTypes: chosen }).forEach((key) => {
        if (!byKey.has(key)) byKey.set(key, { key, name: '', missing: true, taskType: null });
    });
    return [...byKey.values()];
}

export function useTaskTypeOptions({ chosen, projectIds } = {}) {
    const { getters } = useStore();
    const hostProject = inject('selectedProject', null);
    return computed(() => taskTypeOptions({
        companyTypes: getters['settings/AllTaskType'],
        templates: getters['settings/taskType'],
        projects: [...listOf(getters['projectData/allProjects']?.data), getters['projectData/currentProjectDetails'], unref(hostProject)],
        projectIds: unref(projectIds),
        chosen: unref(chosen)
    }));
}
