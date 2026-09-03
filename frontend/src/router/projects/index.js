export default [
    {
        // No project id: the projects list (handoff 10a). With an id the route
        // below opens the project shell.
        path: '/:cid/project',
        name: 'Projects',
        meta: {
            title: "Projects",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "projects-list" */ '@/views/Projects/ProjectsListing/ProjectsListPage.vue'),
    },
    {
        path: '/:cid/project/:id/p',
        name: 'Project',
        meta: {
            title: "Projects",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "project" */ '@/views/Projects/Projects'),
    }, {
        path: '/:cid/project/:id/f/:folderId',
        name: 'ProjectFolder',
        meta: {
            title: "Projects",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "project" */ '@/views/Projects/Projects'),
    }, {
        path: '/:cid/project/:id/fs/:folderId/:sprintId',
        name: 'ProjectFolderSprint',
        meta: {
            title: "Projects",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "project" */ '@/views/Projects/Projects'),
    },
    {
        path: '/:cid/project/:id/fs/:folderId/:sprintId/:taskId',
        name: 'ProjectFolderSprintTask',
        meta: {
            title: "Projects",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "project" */ '@/views/Projects/Projects'),
    },
    {
        path: '/:cid/project/:id/s/:sprintId',
        name: 'ProjectSprint',
        meta: {
            title: "Projects",
                    requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "project" */ '@/views/Projects/Projects'),
    },
    {
        path: '/:cid/project/:id/s/:sprintId/:taskId',
        name: 'ProjectSprintTask',
        meta: {
            title: "Projects",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "project" */ '@/views/Projects/Projects'),
    },
    {
        path: '/:cid/project/:id/recurring',
        name: 'ProjectRecurringTasks',
        meta: {
            title: "Recurring tasks",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: "project" */ '@/views/Projects/RecurringTasks/RecurringTasksManager.vue'),
    }
]