export default [
    {
        path: '/:cid/chat',
        name: 'chats',
        meta: {
            title: "Chat",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "project" */ '@/views/Chat/Chat.vue'),
    },
    {
        path: '/:cid/chat/:pid',
        name: 'chat_project',
        meta: {
            title: "Chat",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "project" */ '@/views/Chat/Chat.vue'),
    },
    {
        path: '/:cid/chat/:pid/:sid',
        name: 'chat_project_channel',
        meta: {
            title: "Chat",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "project" */ '@/views/Chat/Chat.vue'),
    },
    {
        path: '/:cid/chat-notes/:noteId',
        name: 'chat_call_notes',
        meta: {
            title: "Meeting notes",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "project" */ '@/views/Chat/CallNotes.vue'),
    }
]