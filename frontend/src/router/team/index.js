export default [
    {
        path: '/:cid/team',
        name: 'TeamPage',
        meta: {
            title: "Team",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "team" */ '@/views/Team/TeamPage.vue'),
    },
]
