<template>
    <button type="button" class="auth__provider" :disabled="isSpinner" :aria-busy="isSpinner" @click="signInWithGoogle">
        <span v-if="isSpinner" class="oauth-spinner"></span>
        <ShellIcon v-else name="google" :size="16" />
        <span>{{ label || $t('Auth.continue_with', { provider: 'Google' }) }}</span>
    </button>
</template>

<script setup>
import { publicConfig } from "@/config/publicConfig";
/* global google */
import { onMounted, ref, defineProps } from "vue";
import Cookies from 'js-cookie';
import { useToast } from 'vue-toast-notification';
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from "vue-i18n";

// Image

// Utilities
import { apiRequestWithoutSecure, apiRequestWithoutCompnay, getAuth } from "@/services";
import * as env from '@/config/env';

const props = defineProps({
    label: { type: String, default: "" },
    mode: {
        type: String,
        default: "login"
    },
    companyID: {
        type: String,
        default: null
    },
    companyUserDocID: {
        type: String,
        default: null
    }
});

// Composable
const $toast = useToast();
const router = useRouter()
const route = useRoute()
const { t } = useI18n();

// Variables
let googleClient = null;
const userData = ref();
const isSpinner = ref(false)

onMounted(() => {
    if (!window.google) {
        console.error("Google script not loaded!");
        return;
    }

    googleClient = google.accounts.oauth2.initCodeClient({
        client_id: publicConfig.auth.google.clientId,
        scope: "openid email profile",
        ux_mode: "popup",
        redirect_uri: "postmessage",
        callback: handleGoogleCallback,
    });
});

function parseJwt(token) {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(base64))));
}

function signInWithGoogle() {
    if (!googleClient) {
        console.error("Google client not initialized");
        return;
    }
    googleClient.requestCode();
}

const updateUserStatus = (uid) => {
    return new Promise((resolve, reject) => {
        const updateObject = {
            'isOnline': true, 
            'lastActive': new Date() 
        }
        apiRequestWithoutCompnay("put", env.USER_UPATE, {userId: uid, updateObject: updateObject }).then(() => {
            resolve(true)
        }).catch(() => {
            reject(false)
        })
    })
}

const userCompanyStatusCheck = (uid) => {
    return new Promise((resolve, reject) => {
        apiRequestWithoutCompnay("post", env.USER_AND_COMAPNY_CHECK, { userId: uid }).then((res) => {
            resolve(res)
        }).catch(() => {
            reject(false)
        })
    })
}

const login = async (userInfo) => {
    try {
        const object = {
            email: userInfo.email,
            googleId: userInfo.sub,
            // Forward the signed Google ID token so the backend can verify the
            // identity server-side (google-auth-library) instead of trusting the
            // client-supplied email/sub. Without this, login is rejected when
            // the server runs in hardened mode.
            idToken: userInfo.idToken,
            isLoginType: "frontend",
            authProvider: "google"
        }

        // Call login API
        const user = await apiRequestWithoutSecure("post", env.LOGIN, object);
        const userId = user.data.uid;
        localStorage.setItem("userId", userId);

        const [userResponse] = await Promise.all([
            userCompanyStatusCheck(userId),
            getAuth(userId, true)
        ]);

        userData.value = userResponse?.data?.data.userData;
        if (userResponse.data.status == false) {
            localStorage.removeItem("updateToken");
            Cookies.remove('refreshToken');
            Cookies.remove('accessToken');
            throw new Error('MongoDB Error from Api')
        }

        const { userData: uData, companyId: companyID, isCompanyFind } = userResponse.data.data;
        let cid = localStorage.getItem("selectedCompany") ?? companyID;
        if (!uData.isEmailVerified) {
            localStorage.removeItem("updateToken");
            Cookies.remove('refreshToken');
            Cookies.remove('accessToken');
            throw new Error("Verify your email and try again");
        }

        if (uData.AssignCompany && uData.AssignCompany.length) {
            updateUserStatus(userId);
            if (cid && isCompanyFind === false) {
                router.push({ name: "Create_Company" });
                return;
            } else {
                localStorage.setItem('selectedCompany', cid);
            }
        } else {
            updateUserStatus(userId);
            router.push({ name: "Create_Company" });
            return;
        }

        localStorage.setItem('SubmenuScreen', 'project');

        if (route.query.redirect_url && route.query.redirect_url !== '/login') {
            if (route.query.redirect_url === "/") {
                await router.replace(`${route.query.redirect_url}${cid}`);
            } else {
                const tmpcid = route.query.redirect_url?.split("/")[1];
                if ((tmpcid && uData.AssignCompany.includes(tmpcid)) || tmpcid === 'oauth2') {
                    await router.replace(route.query.redirect_url);
                } else {
                    await router.replace(`/${cid}`);
                }
            }
            localStorage.removeItem('ForgotEmail');
            window.location.reload();
        } else {
            localStorage.removeItem('ForgotEmail');
            window.location.reload();
        }

        localStorage.removeItem('ForgotEmail');
    } catch (error) {
        if(error?.response?.data?.isEmailVerified === false && error?.response?.data?.userData) {
            userData.value = error?.response?.data?.userData;
        }
        if (error?.response?.data?.isEmailVerified === false) {
            $toast.error(t('Auth.verify_email_and_try_again'), { position: 'top-right' });
        } else if(error?.response?.data?.message === "Your email is invalid. Please check and try again"){
            $toast.error(t("Toast.Invalid_email"), { position: 'top-right' });
        } else if(error?.response?.data?.message === "Your password is invalid. Please check and try again"){
            $toast.error(t("Toast.Invalid_password"), { position: 'top-right' });
        } else if(error?.response?.data?.message === "Auth.too_many_request"){
            $toast.error(t("Toast.Too_many_request"), { position: 'top-right' });
        } else if (error.error === 'invalid username/password' || error.error_code === 'InvalidPassword') {
            $toast.error(t("Toast.Invalid_username_or_password"), { position: 'top-right' });
        } else if (error.message === "Email Not Verified") {
            $toast.error(t("Toast.Email_Not_Verified"), { position: 'top-right' });
        } else if(error?.response?.data?.message === "User not found"){
            $toast.error('User not found', { position: 'top-right' });
        } else {
            $toast.error(t("Toast.something_went_wrong"), { position: 'top-right' });
        }
        
        Cookies.remove('refreshToken');
        Cookies.remove('accessToken');
        localStorage.removeItem("updateToken");
        localStorage.removeItem("userId");
        localStorage.removeItem("isLogging");
        localStorage.removeItem("remember");
    } finally {
        isSpinner.value = false;
    }
}

const signup = async (userInfo) => {
    try {
        const payload = {
            firstName: userInfo.given_name,
            lastName: userInfo.family_name,
            email: userInfo.email,
            googleId: userInfo.sub,
            assignCompany: props.companyID,
            companyUserDocID: props.companyUserDocID
        };

        const signupRes = await apiRequestWithoutSecure("post", env.API_SIGNUP_WITH_GOOGLE, payload);

        if (!signupRes?.data?.status) {
            throw new Error(signupRes?.data?.message || "Signup failed");
        }

        // After successful signup, directly call login & redirect
        await login(userInfo);
    } catch (error) {
        console.error("Google signup error:", error);
        const msg = error?.response?.data?.message || t("Toast.something_went_wrong");
        $toast.error(msg, { position: "top-right" });
    } finally {
        isSpinner.value = false;
    }
};

async function handleGoogleCallback(response) {
    try {
        isSpinner.value = true;
        if (!response.code) throw new Error("No authorization code received");

        const tokenRes = await apiRequestWithoutSecure("post", `${env.API_OAUTH_GOOGLE}/access-token`, { code: response.code });
        const tokens = tokenRes.data;

        // Decode ID token manually to get profile, and keep the raw token so
        // the backend can verify it (the decoded copy is for display only).
        const userInfo = parseJwt(tokens.id_token);
        userInfo.idToken = tokens.id_token;

        // Call API's
        if (props.mode === 'login') {
            await login(userInfo);
        } else {
            await signup(userInfo);
        }
    } catch (error) {
        console.error("Google login error:", error);
    } finally {
        isSpinner.value = false;
    }
}

</script>