<template>
    <div class="mt-1 custom-field__bg" :class="containerClasses">
        <div class="d-flex align-items-center justify-content-between">
            <h4 :class="headerClasses">
                {{ $t('CustomField.custom_field') }}
            </h4>
            <h4 v-if="props.editPermission" class="font-roboto-sans font-size-14 font-weight-500 font-normal text-decoration-underline blue cursor-pointer" @click="emit('isCustomField', true)">+ {{ $t('CustomField.custom_field') }}</h4>
        </div>
        <TaskAiAutofill :task="props.task" :enabled="props.editPermission" />

        <template v-if="isInitialLoading">
            <template v-for="index in 5" :key="`skeleton-${index}`">
                <Skelaton style="height: 30px;" class="border-radius-6-px mb-5px"/>
            </template>
        </template>
        
        <!-- Content -->
        <!-- Content -->
        <template v-else>
            <template v-if="filteredCustomFields.length">
                <template v-for="item in filteredCustomFields" :key="item._id">
                    <div class="position-re" :class="itemClasses">
                        <component
                            :is="getView(item?.fieldType)"
                            :detail="item"
                            @inputUpdate="handleInputUpdate(item, $event)"
                            @blurUpdate="handleEmit"
                            @handleEdit="handleEdit(item)"
                            @handleUpdate="handleUpdate"
                        />
                    </div>
                </template>
            </template>
        </template>
    </div>
</template>

<script setup>
    import { useStore } from 'vuex';
    import { computed,onMounted, inject, ref, watch } from 'vue';
    import TextComponentListing from '../../atom/customFieldTaskView/textComponentListing.vue';
    import CheckboxComponentListing from '../../atom/customFieldTaskView/checkboxComponentListing.vue';
    import DropdownComponentListing from '../../atom/customFieldTaskView/dropdownComponentListing.vue';
    import DateComponentListing from '../../atom/customFieldTaskView/dateComponentListing.vue';
    import MoneyComponentListing from '../../atom/customFieldTaskView/moneyComponentListing.vue';
    import TextareaComponentListing from '../../atom/customFieldTaskView/textareaComponentListing.vue';
    import NumberComponentListing from '../../atom/customFieldTaskView/numberComponentListing.vue';
    import EmailComponentListing from '../../atom/customFieldTaskView/emailComponentListing.vue';
    import PhoneComponentListing from '../../atom/customFieldTaskView/phoneComponentListing.vue';
    import ComputedComponentListing from '../../atom/customFieldTaskView/computedComponentListing.vue';
    import { computeCustomFieldValue } from '@/plugins/customFieldView/formulaEngine.js';
    import Skelaton from '@/components/atom/Skelaton/Skelaton.vue';
    import TaskAiAutofill from '@/components/molecules/TaskAiAutofill/TaskAiAutofill.vue';


    const { getters } = useStore();
    const isInitialLoading = ref(true);
    const processedCustomFieldList = ref([]);
    // Props
    const props = defineProps({
        task:{
            type:Object,
            default: () => ({})
        },
        editPermission:{
            type: [Boolean, Number],
            default: false
        },
        planPermission:{
            type: [Boolean, Number],
            default:false
        }
    });
    // Emits
    const emit = defineEmits(['blurUpdate','isCustomField','editCustomField']);

    // Injections
    const clientWidth = inject("$clientWidth");

    // Component map for better performance
    const componentMap = {
        text: TextComponentListing,
        checkbox: CheckboxComponentListing,
        dropdown: DropdownComponentListing,
        date: DateComponentListing,
        money: MoneyComponentListing,
        textarea: TextareaComponentListing,
        number: NumberComponentListing,
        email: EmailComponentListing,
        phone: PhoneComponentListing,
        formula: ComputedComponentListing,
        rollup: ComputedComponentListing
    };

    // Flat, de-duped task list (parents + their subtasks) for rollup aggregation.
    // Pulls from the sources actually populated in the List/Board/detail flow — the
    // viewed task's own subtaskArray and the projectData/tasks map — with the
    // dashboard-only projectData/alltasks as a fallback. De-duped by _id so a task
    // present in more than one source is never counted twice. Returns [] on failure
    // so rollups degrade to '—' rather than erroring.
    const getAllTasks = () => {
        try {
            const seen = new Set();
            const flat = [];
            const add = (t) => {
                if (t && t._id && !seen.has(String(t._id))) { seen.add(String(t._id)); flat.push(t); }
            };
            const addWithKids = (t) => {
                add(t);
                if (t && Array.isArray(t.subtaskArray)) t.subtaskArray.forEach(add);
            };
            addWithKids(props.task);
            const map = getters['projectData/tasks'] || {};
            Object.values(map).forEach((byProject) => {
                if (byProject && typeof byProject === 'object') {
                    Object.values(byProject).forEach((node) => {
                        const tasks = node && Array.isArray(node.tasks) ? node.tasks : [];
                        tasks.forEach(addWithKids);
                    });
                }
            });
            const alt = getters['projectData/alltasks'];
            if (Array.isArray(alt)) alt.forEach(addWithKids);
            return flat;
        } catch (error) {
            return [];
        }
    };

    const performanceDelay = (milliseconds) => {
        return new Promise(resolve => {
            const start = performance.now();
            const checkTime = () => {
                if (performance.now() - start >= milliseconds) {
                    resolve();
                } else {
                    requestAnimationFrame(checkTime);
                }
            };
            requestAnimationFrame(checkTime);
        });
    };

    // Computed properties
    const customFieldList = computed(() => getters['settings/finalCustomFields'] || []);

    const filteredCustomFields = computed(() => {
        if (!processedCustomFieldList.value?.length) return [];
        
        return processedCustomFieldList.value.filter(val => 
            val?.isDelete && 
            val?.type === 'task' && 
            (val?.global || val?.projectId?.includes(props?.task?.ProjectID))
        );
    });

    const containerClasses = computed(() => ({'custom-field__height': props.planPermission === false && filteredCustomFields.value.length < 3}));

    const headerClasses = computed(() => ({'font-size-16 font-weight-600': clientWidth <= 767,'font-size-14 font-weight-700': clientWidth > 767}));

    const itemClasses = computed(() => ({'pointer-event-none': !props.editPermission}));

    // Helper function to remove custom field properties
    const removeCustomFieldProperties = (obj) => {
        const propsToRemove = ['fieldValue', 'fieldCode', 'fieldPattern', 'fieldFlag'];
        const cleanObj = { ...obj };
        
        propsToRemove.forEach(prop => {
            delete cleanObj[prop];
        });
    
        return cleanObj;
    };

    // Methods
    const manageCustomField = async(data) => {
        if (!data?.length) {
            processedCustomFieldList.value = [];
            isInitialLoading.value = false;
            return;
        }
        const hasTaskCustomFields = props.task?.customField && 
            Object.keys(props.task.customField).length;
        
        if (hasTaskCustomFields) {
            processedCustomFieldList.value = data.map(val => {
                const taskCustomField = props.task.customField[val._id];
                
                if (taskCustomField) {
                    return {
                        ...val,
                        fieldValue: taskCustomField.fieldValue,
                        fieldCode: taskCustomField?.fieldCode || '',
                        fieldPattern: taskCustomField?.fieldPattern || '',
                        fieldFlag: taskCustomField?.fieldFlag || ''
                    };
                }
                
                // Remove custom field properties if not in task
                return removeCustomFieldProperties(val);
            });
        } else {
            processedCustomFieldList.value = data.map(val =>
                removeCustomFieldProperties(val)
            );
        }
        // Compute read-only formula/rollup values from the live task store (additive only).
        const computedTypes = ['formula', 'rollup'];
        if (processedCustomFieldList.value.some(item => computedTypes.includes(item?.fieldType))) {
            const allTasks = getAllTasks();
            processedCustomFieldList.value = processedCustomFieldList.value.map(item => {
                if (item && computedTypes.includes(item.fieldType)) {
                    return {
                        ...item,
                        fieldValue: computeCustomFieldValue(item, props.task, allTasks, data)
                    };
                }
                return item;
            });
        }
        isInitialLoading.value = false;
    };

    const handleInputUpdate = (item, value) => {
        const index = processedCustomFieldList.value.findIndex(x => x._id === item._id);
        if (index > -1) {
            processedCustomFieldList.value[index] = {
                ...processedCustomFieldList.value[index],
                fieldValue: value
            };
        }
    };

    const handleEdit = (val) => {
        emit("editCustomField",val);
    };
    const handleUpdate = (value,detail,id) => {
        emit('blurUpdate',value,detail,id,true);
    };

    const getView = (fieldType) => {
    return componentMap[fieldType] || null;
    };

    const handleEmit = (value,detail,id) => {
        if(value && detail?.fieldType === 'phone'){
            const index = processedCustomFieldList.value.findIndex(x => x._id === detail._id);
            if (index > -1) {
                processedCustomFieldList.value[index] = {
                    ...processedCustomFieldList.value[index],
                    fieldValue: value
                };
                detail.fieldValue = value;
            }
        }
        emit('blurUpdate',value,detail,id);
    };

    // Lifecycle hooks
    onMounted(async() => {
        await performanceDelay(800);
        manageCustomField(customFieldList.value);
    });

    // Watchers
    watch(() => getters['settings/finalCustomFields'],async(newVal) => {
        await performanceDelay(800);
        manageCustomField(newVal);
    }, { deep: true });

    watch(() => props.task, async() => {
        await performanceDelay(800);
        manageCustomField(customFieldList.value);
    }, { deep: true });
</script>
<style>
    @import './style.css';
</style>
