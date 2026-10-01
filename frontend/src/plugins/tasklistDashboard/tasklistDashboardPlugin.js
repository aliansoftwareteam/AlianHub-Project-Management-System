import { defineAsyncComponent } from 'vue';

export const loadDashBoardList = () => import(/* webpackChunkName: "dashboard-cards" */ './views/DashBoardList/DashBoardList.vue');

export default {
    install (app) {
        const DashBoardList = defineAsyncComponent(loadDashBoardList);
        app.component('DashBoardList', DashBoardList);
        app.provide("DashBoardList", DashBoardList);
    }
}
