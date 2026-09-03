export default [
    {
        path: '/:cid/planner',
        name: 'Planner',
        meta: {
            title: 'Planner',
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "planner" */ '@/views/Planner/Planner.vue')
    },
    {
        path: '/:cid/personal',
        name: 'PersonalList',
        meta: {
            title: 'Personal List',
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "personal-list" */ '@/views/PersonalList/PersonalList.vue')
    }
];
