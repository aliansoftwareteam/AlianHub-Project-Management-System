import { defineAsyncComponent } from 'vue';

export const loadImportUsers = () => import(/* webpackChunkName: "user-import" */ './components/templates/ImportUsers.vue');

export default {
    install(app) {
        app.component('ImportUsers', defineAsyncComponent(loadImportUsers));
    }
};
