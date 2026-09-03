import registerRouter from "../../plugins/register/router";
export default [
    {
        path: '/login',
        name: 'Log-in',
        component: () => import(/* webpackChunkName: "login" */ '@/views/Authentication/Login/Login.vue'),
		meta: {
            title: "Login",
            requiresAuth: false,
        },
    },
    {
        path: '/sso',
        name: 'Sso_Login',
        component: () => import(/* webpackChunkName: "login" */ '@/views/Authentication/Sso/SsoLogin.vue'),
        meta: {
            title: "Sign in with SSO",
            requiresAuth: false,
        },
    },
    {
        path: '/forgot-password',
        name: 'Forgot_Password',
        component: () => import(/* webpackChunkName: "Forgot_Password" */ '@/views/Authentication/ForgotPassword/ForgotPassword.vue'),
        meta: {
            title: 'Forgot Password',
            requiresAuth: false
        }
    },
    {
        path: '/reset-password/:token',
        name: 'Reset_Password',
        component: () => import(/* webpackChunkName: "Reset_Password" */ '@/views/Authentication/ResetPassword/ResetPassword.vue'),
        meta: {
            title: 'Reset Password',
            requiresAuth: false
        }
    },
    {
        path: '/set-new-password/:token',
        name: 'Set_New_Password',
        component: () => import(/* webpackChunkName: "Set_New_Password */ '@/views/Authentication/ResetPassword/SetNewPassword.vue'),
        meta: {
            title: 'Set New Password',
            requiresAuth: false
        }
    },
    ...registerRouter,
    {
        path: '/verify-email/:id/:token',
        name: 'Verify_Email',
        component: () => import(/* webpackChunkName: "Verify_Email" */ '../../views/Authentication/VerifyEmail/VerifyEmail.vue'),
        meta: {
            title: 'Verify Email',
            requiresAuth: false
        }
    },
    {
        path: '/oauth2',
        name: 'Tracker_Login',
        component: () => import(/* webpackChunkName: "Create_Company" */ '../../views/Authentication/TrackerLogin/TrackerLogin.vue'),
        meta: {
            title: 'Authorize_application',
            requiresAuth: true,
            hideHeader: true,
            preventAdvanceSearch: true
        }
    },
    {
        path: '/business',
        name: 'Create_Company',
        component: () => import(/* webpackChunkName: "Create_Company" */ '../../views/Company/CreateCompany.vue'),
        meta: {
            title: 'Company Information',
            requiresAuth: true,
            hideHeader: true,
            preventAdvanceSearch: true
        }
    },
    {
        path: '/verify-invitation',
        name: 'Verify_Invitation',
        component: () => import(/* webpackChunkName: "Verify_Email" */ '@/views/Authentication/VerifyInvitation/VerifyInvitation.vue'),
        meta: {
            title: 'Verify Invitation',
            hideHeader: true
        }
    },
    {
        path: '/invitation',
        name: 'Invitation',
        component: () => import(/* webpackChunkName: "Verify_Email" */ '@/views/Authentication/Invitation/Invitation.vue'),
        meta: {
            title: 'Invitation',
            hideHeader: true,
            requiresAuth: false
        }
    }
]