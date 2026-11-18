import { defineAsyncComponent } from 'vue';

/* The field components share one chunk, fetched when the first of them renders; the app warms it
 * once the shell is up (config/warmChunks.js), so a list's field columns are there with its rows. */
export const CUSTOM_FIELD_LOADERS = {
    CustomFieldRenderViewComponent: () => import(/* webpackChunkName: "custom-fields" */ './component/molecules/customFieldTaskView/customFieldRender.vue'),
    CustomFieldSidebarComponent: () => import(/* webpackChunkName: "custom-fields" */ './component/molecules/customFieldSidebar/customField.vue'),
    SettingCustomFieldViewComponent: () => import(/* webpackChunkName: "custom-fields" */ './component/molecules/settingCustomField/settingCustomFieldComponent.vue'),
    CustomFieldListViewColumnComponent: () => import(/* webpackChunkName: "custom-fields" */ './component/molecules/customFieldViewColumn/customFieldListViewColumn.vue'),
    CustomFieldProjectComponent: () => import(/* webpackChunkName: "custom-fields" */ './component/molecules/customFieldComp/customFieldComp.vue'),
    CustomFieldProjectDetailView: () => import(/* webpackChunkName: "custom-fields" */ './component/molecules/customFieldProjectDetail/customFieldProjectDetail.vue'),
    CustomFieldsSidebarComponent: () => import(/* webpackChunkName: "custom-fields" */ './component/molecules/customFieldSidebar/customFieldsSidebarComponent/customFieldsSidebarComponent.vue')
};

export default {
    install(app) {
        Object.entries(CUSTOM_FIELD_LOADERS).forEach(([name, loader]) => app.component(name, defineAsyncComponent(loader)));
    }
};
