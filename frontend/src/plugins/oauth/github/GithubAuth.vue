<template>
    <button @click="loginWithGitHub" class="border-0 border-radius-6-px cursor-pointer p-15px" :disabled="isLoading" title="Github">
        <div v-if="isLoading" class="oauth-spinner"></div>
        <img v-else :src="GithubIcon" alt="github-icon"/>
    </button>
</template>

<script setup>
import { onMounted, ref, defineProps } from "vue";
import Cookies from 'js-cookie';
import { useToast } from 'vue-toast-notification';
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from "vue-i18n";

// Image
import GithubIcon from "@/assets/images/svg/github_icon.svg";

// Utilities
import { apiRequestWithoutSecure, apiRequestWithoutCompnay, getAuth } from "@/services";
import * as env from '@/config/env';

const props = defineProps({
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
const userData = ref();
const isLoading = ref(false);

onMounted(async () => {
    // Only handle the redirect if THIS provider started it. GitHub and GitLab
    // both come back with ?code=, so without this guard both components would
    // grab the same code and one would strip it from the URL before the other.
    if (!localStorage.getItem("githubAuthMode")) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;

    try {        
        const res = await apiRequestWithoutSecure("post", `${env.API_OAUTH_GITHUB}/access-token`, JSON.stringify({ code }));
        if (!res.data.accessToken) return;

        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.delete("code");
        window.history.replaceState({}, document.title, currentUrl.toString());

        await fetchGitHubUser(res.data.accessToken);
    } catch (err) {
        console.error(err);
    }
});

// Trigger GitHub OAuth
function loginWithGitHub() {
    localStorage.setItem("githubAuthMode", props.mode);
    const clientId = process.env.VUE_APP_GITHUB_CLIENT_ID;
    const scope = "read:user user:email";
    const redirectUri = window.location.origin; 
    const githubAuthUrl = `${process.env.VUE_APP_GITHUB_BASE_OAUTH_URL}/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;
    window.location.href = githubAuthUrl;
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
            githubId: userInfo.githubId,
            // Forward the GitHub access token so the backend can re-verify the
            // identity against GitHub's /user API instead of trusting the
            // client-supplied id/email. Without this, login is rejected in the
            // default (strict) server mode.
            accessToken: userInfo.accessToken,
            isLoginType: "frontend",
            authProvider: "github"
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
        isLoading.value = false;
        localStorage.removeItem("githubAuthMode");
        localStorage.removeItem("companyID");
        localStorage.removeItem("companyUserDocID");
    }
}

const signup = async (userInfo) => {
    try {
        const companyId = localStorage.getItem("companyId");
        const companyUserDocID = localStorage.getItem("companyUserDocID");
        const payload = {
            firstName: userInfo.firstName,
            lastName: userInfo.lastName,
            email: userInfo.email,
            githubId: userInfo.githubId,
            assignCompany: companyId,
            companyUserDocID: companyUserDocID
        };

        const signupRes = await apiRequestWithoutSecure("post", env.API_SIGNUP_WITH_GITHUB, payload);

        if (!signupRes?.data?.status) {
            throw new Error(signupRes?.data?.message || "Signup failed");
        }

        // After successful signup, directly call login & redirect
        $toast.success('User register successfully', { position: 'top-right' });
        setTimeout(() => login(userInfo), 1000);
    } catch (error) {
        console.error("Google signup error:", error);
        const msg = error?.response?.data?.message || t("Toast.something_went_wrong");
        $toast.error(msg, { position: "top-right" });
    } finally {
        isLoading.value = false;
        localStorage.removeItem("githubAuthMode");
        localStorage.removeItem("companyID");
        localStorage.removeItem("companyUserDocID");
    }
};

// Fetch user details and login
async function fetchGitHubUser(token) {
    try {
        isLoading.value = true;

        // Fetch basic profile
        const resUser = await fetch("https://api.github.com/user", {
            headers: { Authorization: `token ${token}` },
        });

        const userData = await resUser.json();
        if (!resUser.ok) return;

        // Fetch emails
        const resEmails = await fetch("https://api.github.com/user/emails", {
            headers: { Authorization: `token ${token}` },
        });

        const emails = await resEmails.json();
        if (resEmails.ok && Array.isArray(emails)) {
            // Find primary verified email
            const primaryEmailObj = emails.find(e => e.primary && e.verified);
            if (primaryEmailObj) {
                userData.email = primaryEmailObj.email;
            } else if (emails.length > 0) {
                // fallback to first email
                userData.email = emails[0].email;
            }
        }
        
        const fullName = userData.name || ""; // might be null
        const [firstName, ...lastParts] = fullName.split(" ");
        const lastName = lastParts.join(" "); // Handles middle names

        const userInfo = {
            email: userData.email,
            githubId: userData.id,
            firstName,
            lastName,
            accessToken: token,
        }

        // Call API's
        const mode = localStorage.getItem("githubAuthMode");
        if(!mode) return;

        if (mode === 'login') {
            login(userInfo);
        } else {
            signup(userInfo);
        }
    } catch (err) {
        console.error("Error fetching GitHub user or emails:", err);
        isLoading.value = false;
    }
}

</script>