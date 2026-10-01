<template lang="">
    <div v-if="navOptions.length > 0" class="view__list-dropdown" :id='tourId'>
        <div class="view__search">
            <input
                type="search"
                class="view__search-input"
                v-model="query"
                :placeholder="$t('Projects.search_views')"
                :aria-label="$t('Projects.search_views')"
            >
        </div>

        <div class="view__groups style-scroll">
            <div v-if="embedItem" class="view__embed">
                <button type="button" class="view__back" @click="embedItem = null">{{$t('Projects.back')}}</button>
                <EmbedView :projectData="projectData" @closeDropdown="emits('closeDropdown')"/>
            </div>

            <template v-else>
                <section v-for="group in visibleGroups" :key="group.key" class="view__group">
                    <h3 class="view__group-title">{{$t(group.labelKey)}}</h3>
                    <div class="view__grid">
                        <button
                            type="button"
                            v-for="item in group.items"
                            :key="item._id"
                            class="view__cell"
                            :class="{'is-added': isAdded(item)}"
                            :disabled="isAdded(item)"
                            :title="item.description ? $t(`ViewListdescription.${item.description}`) : null"
                            @click="selectView(item)"
                        >
                            <img class="view__cell-icon" :src="projectComponentsIcons(item.keyName)?.icon" alt="" aria-hidden="true">
                            <span class="view__cell-name">{{$t(`ViewList.${item.name}`)}}</span>
                            <span class="view__cell-tag">{{$t(viewTagKey(item.keyName))}}</span>
                        </button>
                    </div>
                </section>

                <ViewTemplateList
                    v-if="visibleTemplates.length"
                    :templates="visibleTemplates"
                    :adding="addingFromTemplate"
                    @pick="addFromTemplate"
                    @changed="loadTemplates"
                />

                <p v-if="!visibleGroups.length && !visibleTemplates.length" class="view__empty">{{$t('Projects.no_views_match')}}</p>
            </template>
        </div>

        <div class="view__footer" v-if="!embedItem">
            <label class="view__option" :for="privateId">
                <input type="checkbox" :id="privateId" v-model="isPrivate">
                <span class="view__option-text">{{$t('Projects.private_view')}}</span>
            </label>
            <label class="view__option" :for="pinId">
                <input type="checkbox" :id="pinId" v-model="isPin">
                <span class="view__option-text">{{$t('Projects.pin')}} {{$t('Projects.view')}}</span>
            </label>
        </div>
    </div>
</template>
<script setup>
// UTILS
import { addView } from '@/components/molecules/EmbedView/helper.js'
import { addPrivateView, groupViews, viewTagKey } from './helper.js'
import { addViewFromTemplate, errorText, fittingTemplates, leftOutText, useViewTemplates } from './viewTemplates'
import { createPrivateView } from '@/views/Projects/composables/savedViewApi'
import { useCustomComposable } from "@/composable";
import * as env from '@/config/env';
import { projectComponentsIcons } from '@/composable/commonFunction';

// COMPONENTS
import EmbedView from '@/components/molecules/EmbedView/EmbedView.vue'
import ViewTemplateList from './ViewTemplateList.vue'

// PACKAGES
import { ref, onMounted, inject, computed, watch } from 'vue'
import { useToast } from 'vue-toast-notification'
import { useStore } from 'vuex';
import { apiRequest } from '../../../services';
import { useI18n } from "vue-i18n";
const { t } = useI18n();

const {makeUniqueId} = useCustomComposable();
const { getters,commit } = useStore();
const props = defineProps({
    projectData:{
        type:Object,
        default:() => {}
    },
    tourId: {
        type: String,
        default: ''
    }
})

const companyUserData = computed(()=> { return getters['settings/companyUsers']})
const toast = useToast()
const emits = defineEmits(['closeDropdown','handleCloseDropdown'])
const isPin = ref(false)
const isPrivate = ref(false)
const navOptions = ref('')
const query = ref('')
const embedItem = ref(null)
const privateId = `view-private-${makeUniqueId(6)}`
const pinId = `view-pin-${makeUniqueId(6)}`
/* Only the description survives from the old preview pane; the PNGs it showed were
 * shared across views (Forms showed a table, Map a workload chart), so the cells
 * render each view's own icon from projectComponentsIcons instead. */
const descriptions = {
    ProjectListView: 'list_view',
    ProjectKanban: 'kanban_view',
    ProjectDetail: 'projectdetail_view',
    Comments: 'Comments_view',
    Calendar: 'calender_view',
    TableView: 'table_view',
    Workload: "workload_view",
    ActivityLog: 'activitylog_view',
    Reports: 'reports_view',
    GanttView: 'gantt_view',
    RecurringTasks: 'recurring_view',
    TimelineView: 'timeline_view',
    MindMapView: 'mindmap_view',
    WhiteboardView: 'whiteboard_view',
    CanvasView: 'canvas_view',
    MapView: 'map_view',
    ProjectDashboard: 'dashboard_view',
    DocsView: 'docs_view',
    FormsView: 'forms_view'
}
const companyId = inject('$companyId')
const userId = inject('$userId')
const companyUser = ref()
const Data = ref('')

onMounted(() => {
    Data.value = {...props.projectData}
    const queryRef = apiRequest("get", `${env.PROJECTS_TABS}`)
    queryRef.then((response) => {
        const data = response.data;
        navOptions.value = data.map((item) => { return {...item , description : descriptions[item?.keyName] , sortIndex: item?.sortIndex != 6 && item?.sortIndex != 9 ? item?.sortIndex : (item?.sortIndex == 9 ? 6 : 9 ) }})
        navOptions.value = (navOptions.value.filter((element) => element?.keyName != 'Gantt' && element?.keyName != 'Timeline')).sort((a,b) => (a.sortIndex < b.sortIndex) ? -1 : 1 )
        // Collapse duplicate catalog records that resolve to the same view label — an
        // existing company can carry a legacy "Timeline" record alongside the new
        // "Timeline View" (both display as "Timeline"). Keep the first after sort.
        const seenViewLabels = new Set();
        navOptions.value = navOptions.value.filter((element) => {
            const label = t(`ViewList.${element?.name}`);
            if (seenViewLabels.has(label)) return false;
            seenViewLabels.add(label);
            return true;
        });
    })
    companyUser.value = (companyUserData.value.filter((item) => userId.value === item.userId )[0])
})

const addedNames = computed(() => {
    const projectViews = Data.value?.ProjectRequiredComponent || [];
    const privateViews = companyUser.value?.ProjectRequiredComponent
        ? Object.values(companyUser.value.ProjectRequiredComponent).filter((item) => props.projectData._id == item.projectId)
        : [];
    return new Set([...projectViews, ...privateViews].map((item) => item?.name));
});

const isAdded = (item) => addedNames.value.has(item?.name);

const visibleGroups = computed(() => {
    const term = query.value.trim().toLowerCase();
    const options = Array.isArray(navOptions.value) ? navOptions.value : [];
    const matches = !term ? options : options.filter((item) => {
        const name = t(`ViewList.${item.name}`).toLowerCase();
        const tag = t(viewTagKey(item.keyName)).toLowerCase();
        return name.includes(term) || tag.includes(term);
    });
    return groupViews(matches);
});

const { templates, load: loadTemplates } = useViewTemplates()
const addingFromTemplate = ref(false)
const PRIVATE_COPIED_FIELDS = ['_id', 'keyName', 'name', 'value', 'icon', 'activeIcon', 'sortIndex']

const visibleTemplates = computed(() => {
    const term = query.value.trim().toLowerCase();
    const fitting = fittingTemplates(templates.value, Array.isArray(navOptions.value) ? navOptions.value : []);
    return !term ? fitting : fitting.filter((template) => String(template.name).toLowerCase().includes(term)
        || t(`ViewList.${template.viewName}`).toLowerCase().includes(term));
});

/* The server fits the template to this project and hands the view back; a private one is stored on the member row, as every private view is. */
const keepPrivately = async (draft) => {
    const row = companyUserData.value.find((item) => userId.value === item.userId);
    const view = {
        ...Object.fromEntries(PRIVATE_COPIED_FIELDS.filter((field) => draft[field] !== undefined).map((field) => [field, draft[field]])),
        id: makeUniqueId(10),
        isPrivate: true,
        isPin: isPin.value,
        projectId: Data.value._id,
        sourceViewId: draft._id,
        title: draft.title,
        settings: draft.settings,
        createdAt: new Date(),
    };
    await createPrivateView(row._id, view);
    commit('settings/mutateCompanyUsers', { data: { ...row, ProjectRequiredComponent: [...(row.ProjectRequiredComponent || []), view] }, op: 'modified' });
};

const addFromTemplate = async (template) => {
    if (addingFromTemplate.value) return;
    addingFromTemplate.value = true;
    try {
        const response = await addViewFromTemplate(Data.value._id, { templateId: template._id, isPin: isPin.value, isPrivate: isPrivate.value });
        if (isPrivate.value) await keepPrivately(response.data);
        else commit('projectData/projectLocalUpdate', { itemData: response.data, projectId: Data.value._id, key: 'ProjectView', subKey: 'add', userId: '' });
        const leftOut = leftOutText(response.leftOut, t);
        if (leftOut) toast.warning(leftOut, { position: 'top-right' });
        else toast.success(t('Toast.View_added_successfully'), { position: 'top-right' });
        emits('closeDropdown');
    } catch (error) {
        toast.error(errorText(error, t('ViewTemplates.add_failed')), { position: 'top-right' });
    } finally {
        addingFromTemplate.value = false;
    }
};

const selectView = (item) => {
    if (item.keyName === 'Embed') {
        embedItem.value = {...item};
        return;
    }
    handleSubmit(item);
    emits('handleCloseDropdown');
};

watch(() => getters['projectData/projects']?.data?.find((x) => x._id === Data.value?._id) , () => {
    Data.value = getters['projectData/projects']?.data?.find((x) => x._id === Data.value?._id)
})

const handleSubmit = (item) =>{
    if(isAdded(item)) {
        toast.error(t("Toast.View_Already_Added"), {position:'top-right'})
        return
    }
    const payload = {...item, isPin: isPin.value};
    ['updatedAt', 'createdAt', 'description'].forEach((key) => delete payload[key]);

    if(!isPrivate.value) {
        addView({cid: companyId.value, pid: Data.value._id}, payload).then((res) => {
            commit('projectData/projectLocalUpdate', {itemData: res.data,projectId: Data.value._id,key:"ProjectView",subKey:"add",userId: ''});
            toast.success(res.statusText , {position:'top-right'})
        }).catch((err) =>{
            console.error(err.statusText)
        })
    } else {
        addPrivateView({cid:companyId.value, uid:companyUser.value._id, uniqueId:makeUniqueId(10)}, {...payload, isPrivate: true, projectId: Data.value._id}).then((res) => {
            toast.success(t(`Toast.${res.statusText}`), {position:'top-right'})
        }).catch((err) => {
            console.error(err.statusText)
        })
    }
    emits('closeDropdown')
}

</script>
<style>
@import './style.css';
</style>