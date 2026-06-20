import CustomFieldRouter from "../../plugins/customFieldView/router.js";
export default [
    {
        path: '/:cid/settings',
        redirect: { name: 'Setting' },
        name: "Settings",
        meta: {
            title: "Settings",
            requiresAuth: true
        },
        component: () => import(/* webpackChunkName: Settings */ '@/components/templates/Settings/Settings.vue'),
        children: [
            {
                path: "setting",
                name: "Setting",
                meta: {
                    title: "Settings",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: Settings */ '@/views/Settings/Setting/Setting.vue')
            },
            
            ...CustomFieldRouter,
            {
                path: "members",
                name: "Members",
                meta: {
                    title: "Members",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: Members */ '@/views/Settings/Members/Members.vue')
            },
            {
                path: "sso",
                name: "SsoSettings",
                meta: {
                    title: "SSO",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: SsoSettings */ '@/views/Settings/Sso/SsoSettings.vue')
            },
            {
                path: "audit-logs",
                name: "AuditLog",
                meta: {
                    title: "Audit Log",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: AuditLog */ '@/views/Settings/Audit/AuditLog.vue')
            },
            {
                path: "scim",
                name: "ScimSettings",
                meta: {
                    title: "SCIM",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: ScimSettings */ '@/views/Settings/Scim/ScimSettings.vue')
            },
            {
                path: "teams",
                name: "Teams",
                meta: {
                    title: "Teams",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: Teams */ '@/views/Settings/Teams/Teams.vue')
            },
            {
                path: "projects",
                name: "Settings-Projects",
                meta: {
                    title: "Projects",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: Projects */ '@/views/Settings/Projects/Projects.vue')
            },
            {
                path: "template",
                name: "Template",
                meta: {
                    title: "Templates",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: Template */ '@/views/Settings/Template/Template.vue')
            },
            {
                path: "security-permissions",
                name: "Security & Permissions",
                meta: {
                    title: "Security & Permissions",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: Security & Permissions */ '@/views/Settings/SecurityPermissions/SecurityPermissions.vue')
            },
            {
                path: "my-profile",
                name: "My Profile",
                meta: {
                    title: "My Profile",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: My Profile */ '@/views/Settings/MySettings/MySettings.vue')
            },
            {
                path: "change-password",
                name: "changePassword",
                meta: {
                    title: "Change Password",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: Change Password */ '@/views/Settings/ChangePassword/ChangePassword.vue')
            },
            {
                path: "two-factor-auth",
                name: "twoFactorAuth",
                meta: {
                    title: "Two-Factor Authentication",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: Two Factor Auth */ '@/views/Settings/TwoFactorAuth/TwoFactorAuth.vue')
            },
            {
                path: "integrations",
                name: "Integrations",
                meta: {
                    title: "Integrations",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: Integrations */ '@/views/Settings/Integrations/Integrations.vue')
            },
            {
                path: "company",
                name: "Company",
                meta: {
                    title: "Company",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: Company */ '@/views/Settings/Company/Company.vue')
            },
            {
                path: "notifications",
                name: "Notifications",
                meta: {
                    title: "Notifications",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: Notifications */ '@/views/Settings/Notifications/Notifications.vue')
            },
            {
                path: "time-tracking",
                name: "Time Tracking",
                meta: {
                    title: "Time Tracking",
                    requiresAuth: true
                },
                component: () => import(/* webpackChunkName: Time Tracking */ '@/views/Settings/TimeTracking/TimeTracking.vue')
            },
        ]
    },
]