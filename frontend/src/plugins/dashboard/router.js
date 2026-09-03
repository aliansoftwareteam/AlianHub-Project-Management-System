const dashboardRouter = [{
    path: "/",
    name: "dashboard",
    component: () => import(/* webpackChunkName: "home" */ './views/Home'),
    meta: {
        title: 'Home',
        requiresAuth: true,
    },
    // "/" is the legacy card dashboard. A signed-in user with a workspace
    // should land on Home; the cards live under /:cid/dashboards now.
    beforeEnter: (to) => {
        const cid = localStorage.getItem('selectedCompany');
        return cid ? { name: 'Home', params: { cid }, query: to.query } : true;
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
