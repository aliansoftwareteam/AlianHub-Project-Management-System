/* One page behind both: /:cid/goals/:goalId is the list with that goal's panel open. */
const goalsPage = () => import(/* webpackChunkName: "goals" */ '@/views/Goals/Goals.vue');

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
        path: '/:cid/everything',
        name: 'Everything',
        meta: {
            title: 'Everything',
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "everything" */ '@/views/Everything/Everything.vue')
    },
    {
        path: '/:cid/goals',
        name: 'Goals',
        meta: {
            title: 'Goals',
            requiresAuth: true
        },
        component: goalsPage
    },
    {
        path: '/:cid/goals/:goalId',
        name: 'Goal',
        meta: {
            title: 'Goals',
            requiresAuth: true
        },
        component: goalsPage
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
