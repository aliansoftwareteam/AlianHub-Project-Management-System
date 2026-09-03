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
    component: () => import(/* webpackChunkName: "home" */ './views/Home'),
    meta: {
        title: 'Dashboards',
        requiresAuth: true,
    }
}];

export default {
    dashboardRouter
};
