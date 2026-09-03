export default [
    {
        path: '/:cid/ai',
        name: 'AiHub',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/AiHub.vue'),
        meta: { title: 'AI Agents', requiresAuth: true }
    },
    {
        path: '/:cid/ai/inbox',
        name: 'AiInbox',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/AiInbox.vue'),
        meta: { title: 'AI Inbox', requiresAuth: true }
    },
    {
        path: '/:cid/ai/skills',
        name: 'AiSkills',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/SkillLibrary.vue'),
        meta: { title: 'Skill library', requiresAuth: true }
    },
    {
        path: '/:cid/ai/agent/:id',
        name: 'AiAgent',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/AgentSettings.vue'),
        meta: { title: 'Agent settings', requiresAuth: true }
    }
];
