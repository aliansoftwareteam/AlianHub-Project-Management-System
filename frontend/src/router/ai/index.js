import { BLUEPRINT_WELCOME_PATH, BLUEPRINT_WELCOME_ROUTE, CONNECT_AI_ROUTE, CONNECT_AI_WELCOME_PATH, CONNECT_AI_WELCOME_ROUTE } from './connect';

export default [
    { path: '/:cid/ai', redirect: { name: 'AiAsk' } },
    // Home and Analytics were placeholder screens; links saved before they left still land on Ask.
    { path: '/:cid/ai/home', redirect: { name: 'AiAsk' } },
    { path: '/:cid/ai/analytics', redirect: { name: 'AiAsk' } },
    {
        path: '/:cid/ai/agents',
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
        path: '/:cid/ai/team-packs',
        name: 'AiTeamPacks',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/AiTeamPacks.vue'),
        meta: { title: 'Team packs', requiresAuth: true }
    },
    {
        path: '/:cid/ai/ask',
        name: 'AiAsk',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/AskPage.vue'),
        meta: { title: 'Ask', requiresAuth: true }
    },
    {
        path: '/:cid/ai/pipeline',
        name: 'AiPipeline',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/AiPipeline.vue'),
        meta: { title: 'Pipeline', requiresAuth: true }
    },
    {
        path: '/:cid/ai/release',
        name: 'AiRelease',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/AiRelease.vue'),
        meta: { title: 'Release & deploy', requiresAuth: true }
    },
    {
        path: '/:cid/ai/health',
        name: 'AiHealth',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/AiHealth.vue'),
        meta: { title: 'AI health', requiresAuth: true }
    },
    {
        path: '/:cid/ai/quality',
        name: 'AiQuality',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/AiQuality.vue'),
        meta: { title: 'AI quality', requiresAuth: true }
    },
    {
        path: '/:cid/ai/workflows/runs/:id',
        name: 'WorkflowRun',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/WorkflowRunView.vue'),
        meta: { title: 'Workflow run', requiresAuth: true }
    },
    {
        path: '/:cid/ai/workflows/runs/:id/lineage',
        name: 'WorkflowLineage',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/WorkflowLineageView.vue'),
        meta: { title: 'Workflow lineage', requiresAuth: true }
    },
    {
        path: '/:cid/ai/accounts',
        name: 'AiAccounts',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/AiAccounts.vue'),
        meta: { title: 'Coding accounts', requiresAuth: true }
    },
    {
        path: '/:cid/ai/connect',
        name: CONNECT_AI_ROUTE,
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/ConnectYourAi.vue'),
        meta: { title: 'Connect your AI', requiresAuth: true }
    },
    {
        path: CONNECT_AI_WELCOME_PATH,
        name: CONNECT_AI_WELCOME_ROUTE,
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/ConnectYourAi.vue'),
        meta: { title: 'Connect your AI', requiresAuth: true, hideHeader: true, welcome: true }
    },
    {
        path: BLUEPRINT_WELCOME_PATH,
        name: BLUEPRINT_WELCOME_ROUTE,
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/BlueprintWelcome.vue'),
        meta: { title: 'Set up your teams', requiresAuth: true, hideHeader: true, welcome: true }
    },
    {
        path: '/:cid/ai/runs/:runId',
        name: 'AiRun',
        component: () => import(/* webpackChunkName: "ai" */ '@/views/Ai/AgentRunPage.vue'),
        meta: { title: 'Agent run', requiresAuth: true }
    }
];
