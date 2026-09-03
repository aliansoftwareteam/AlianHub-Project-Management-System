const dashboardRouter = [{
    path: "/",
    name: "dashboard",
    component: () => import(/* webpackChunkName: "home" */ './views/Home'),
    meta: {
        title: 'Home',
        requiresAuth: true,
    }
},
{
    path: "/:cid",
    name: "Home",
    component: () => import(/* webpackChunkName: "home-v2" */ '@/views/Home/TodayOverdue.vue'),
    meta: {
        title: 'Home',
        requiresAuth: true,
    }
},
{
    path: "/:cid/dashboards",
    name: "Dashboards",
    component: () => import(/* webpackChunkName: "dashboards" */ '@/views/Dashboards/DashboardsHub.vue'),
    meta: {
        title: 'Dashboards',
        requiresAuth: true,
    }
},
{
    path: "/:cid/dashboards/:dashboardId",
    name: "DashboardView",
    component: () => import(/* webpackChunkName: "dashboards" */ '@/views/Dashboards/DashboardView.vue'),
    meta: {
        title: 'Dashboard',
        requiresAuth: true,
    }
}];

export default {
    dashboardRouter
};
