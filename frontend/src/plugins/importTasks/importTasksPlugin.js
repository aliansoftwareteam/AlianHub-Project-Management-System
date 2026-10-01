import { defineAsyncComponent } from 'vue';

export const loadImportTaskButton = () => import(/* webpackChunkName: "task-import" */ './components/templates/ImportTaskButton.vue');

export default {
    install (app) {
        app.component('ImportTaskButton', defineAsyncComponent(loadImportTaskButton))
    }
}
