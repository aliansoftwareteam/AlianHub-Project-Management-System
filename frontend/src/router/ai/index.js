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
    },
    {
        path: '/:cid/ai/teammates',
        name: 'AgentTeammates',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/AgentTeammates.vue'),
        meta: { title: 'Agents as teammates', requiresAuth: true }
    },
    {
        path: '/:cid/ai/routing',
        name: 'AgentRouting',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/AgentRouting.vue'),
        meta: { title: 'Route tasks to agents', requiresAuth: true }
    },
    {
        path: '/:cid/ai/ask',
        name: 'AiAsk',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/AskPage.vue'),
        meta: { title: 'Ask', requiresAuth: true }
    }
];
