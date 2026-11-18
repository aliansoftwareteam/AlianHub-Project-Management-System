export default [
    {
        path: '/:cid/reports/sprint',
        name: 'SprintReport',
        meta: { title: 'Sprint report', requiresAuth: true },
        component: () => import(/* webpackChunkName: "SprintReport" */ '@/views/Projects/Reports/SprintReportPage.vue'),
    },
    {
        path: '/:cid/reports/velocity',
        name: 'VelocityFlow',
        meta: { title: 'Velocity & flow', requiresAuth: true },
        component: () => import(/* webpackChunkName: "VelocityFlow" */ '@/views/Projects/Reports/VelocityFlowPage.vue'),
    },
    {
        path: '/:cid/reports/milestones',
        name: 'MilestonesReport',
        meta: { title: 'Milestones', requiresAuth: true },
        component: () => import(/* webpackChunkName: "MilestonesReport" */ '@/views/Projects/Reports/MilestonesReportPage.vue'),
    },
]
