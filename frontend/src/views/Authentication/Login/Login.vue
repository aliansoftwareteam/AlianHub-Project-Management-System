<template>
	<AuthTemplate v-if="isShowResend === false && twoFactor.show === false">
		<div class="ah-rightside" :class="[{'disableInputField':submitted}]">
			<div class="sinup-login-title-wrapper">
                <h3>{{$t('Auth.login_statement')}}</h3>
                <p>{{$t('Auth.login_descriptioon')}}</p>
            </div>
            <!-- Login with auth -->
            <form action="#" @submit.prevent="handleSubmit">
            <div class="form-group">
                <label for="email">{{$t('Auth.email_id')}}<span class="invalid-feedback red">*</span></label>
                <InputText
                    id="email"
                    class="login-input"
                    placeHolder="Enter your email"
                    v-model.trim="formData.email.value"
                    height="56px"
                    width="100%"
                    @keyup="checkErrors({'field':formData.email,
                    'name':formData.email.name,
                    'validations':formData.email.rules,
                    'type':formData.email.type,
                    'event':$event.event})"
                    @input="formData.email.value = formData.email.value.toLowerCase()"
                    maxlength="254"
                    ref="useremail"
                    type="text"
                    @enter="handleSubmit"
                 />
                <div class="invalid-feedback red">{{formData.email.error}}</div>
            </div>

            <div class="form-group">
                <label for="password">{{ $t('Auth.Password') }}<span class="invalid-feedback red">*</span></label>
                <InputText
                    id="password"
                    class="login-input pwd_login pwd__input"
                    placeHolder="*****"
                    v-model="formData.password.value"
                    height="56px"
                    width="100%"
                    @keyup="checkErrors({'field':formData.password,
                    'name':formData.password.name,
                    'validations':formData.password.rules,
                    'type':formData.password.type,
                    'event':$event.event})"
                    maxlength="150"
                    ref="useremail"
                    :type="inputType"
                    @enter="handleSubmit"
                 />
                <div class="invalid-feedback red">{{formData.password.error}}</div>
                <span @click="togglePasswordInput" class="cursor-pointer position-ab d-flex align-items-center eye">
                    <img v-if="inputType === 'password'" src="@/assets/images/password_view_hide.png" class="password-view"/>
                    <img v-else src="@/assets/images/password_view_show.png" class="password-view"/>
                </span>
            </div>

            <div class="form-group d-flex checkbox-label login-checkbox">
                <div class="login-check-box-wrpper">
                    <input type="checkbox" class="styled-checkbox position-ab opacity-none" id="chk-remember-me" v-model="rememberMe" :disabled="isSpinner">
                    <label for="chk-remember-me" class="chk-label d-flex align-items-center">
                    <span class="gray"> {{ $t('Auth.RememberMeL') }}</span>
                    </label>
                </div>
                <router-link @click="handleForgotPassword" :style="[{'pointer-events' : isSpinner ? 'none' : ''}]" to="/forgot-password">{{ $t('Auth.Forgot_Password') }}?</router-link>
            </div>

            <div class="form-group">
                <p v-if="errorMessage" class="login-info-message">{{ errorMessage }}</p>
                <button v-if="!isSpinner && !errorMessage" type="submit" class="btn btn-blue btn-login font-roboto-sans bg-blue white cursor-pointer font-weight-500" tabindex="3">{{$t(`Auth.loging`)}}</button>
                <button v-if="isSpinner && !errorMessage" type="button" class="btn btn-blue btn-login font-roboto-sans bg-blue white cursor-pointer font-weight-500" tabindex="3" disabled>
                    {{ $t('Auth.loading') }}
                    <div class="load">
                        <div class="progress"></div>
                        <div class="progress"></div>
                        <div class="progress"></div>
                    </div>
                </button>
            </div>
            <div v-if="isDemoMode && !isSpinner && !errorMessage" class="demo-login-buttons">
                <button type="button" class="btn btn-blue btn-login btn-demo-login font-roboto-sans cursor-pointer font-weight-500" tabindex="4" @click="ownerLogin">Login as Owner/Admin</button>
                <button type="button" class="btn btn-blue btn-login btn-demo-login font-roboto-sans cursor-pointer font-weight-500" tabindex="5" @click="memberLogin">Login as Member</button>
            </div>
            <RegisterViewComponent @handleChange="handleChange" :isSpinner="isSpinner" />
            <!-- <div class="create-accountlink text-center">
                <span class="font-roboto-sans font-weight-normal font-weight-400 gray">{{$t('Auth.NotR')}}? <router-link :style="[{'pointer-events' : isSpinner ? 'none' : ''}]" to="/signup" class="light-purple font-weight-500">{{$t('Auth.createAcc')}}</router-link></span>
            </div> -->
            </form>
            <div class="custom-divider my-1" v-if="isDevider">
                <div class="custom-divider-text">Or Continue With</div>
            </div>
            <!-- oAuth -->
            <oAuthProviders mode="login"/>
		</div>
	</AuthTemplate>
    <AuthTemplate v-if="twoFactor.show === true">
        <div class="ah-rightside" :class="[{'disableInputField':submitted}]">
            <div class="sinup-login-title-wrapper">
                <h3>{{ $t('Auth.two_factor_title') }}</h3>
                <p>{{ twoFactor.isRecovery ? $t('Auth.two_factor_recovery_hint') : $t('Auth.two_factor_hint') }}</p>
            </div>
            <form action="#" @submit.prevent="submit2fa">
                <div class="form-group">
                    <label for="twofa-code">{{ twoFactor.isRecovery ? $t('Auth.two_factor_recovery_label') : $t('Auth.two_factor_code_label') }}<span class="invalid-feedback red">*</span></label>
                    <InputText
                        id="twofa-code"
                        class="login-input"
                        :placeHolder="twoFactor.isRecovery ? 'xxxxx-xxxxx' : '123456'"
                        v-model.trim="twoFactor.code"
                        height="56px"
                        width="100%"
                        maxlength="20"
                        type="text"
                        @enter="submit2fa"
                    />
                    <div class="invalid-feedback red">{{ twoFactor.error }}</div>
                </div>
                <div class="form-group">
                    <button v-if="!isSpinner" type="submit" class="btn btn-blue btn-login font-roboto-sans bg-blue white cursor-pointer font-weight-500">{{ $t('Auth.two_factor_verify') }}</button>
                    <button v-else type="button" class="btn btn-blue btn-login font-roboto-sans bg-blue white cursor-pointer font-weight-500" disabled>
                        {{ $t('Auth.loading') }}
                        <div class="load">
                            <div class="progress"></div>
                            <div class="progress"></div>
                            <div class="progress"></div>
                        </div>
                    </button>
                </div>
                <div class="create-accountlink text-center">
                    <span class="font-roboto-sans light-purple font-weight-500 cursor-pointer" @click="toggleRecoveryMode">
                        {{ twoFactor.isRecovery ? $t('Auth.two_factor_use_app') : $t('Auth.two_factor_use_recovery') }}
                    </span>
                </div>
                <div class="create-accountlink text-center mt-2">
                    <span class="font-roboto-sans gray cursor-pointer" @click="backToLoginFrom2fa">{{ $t('Auth.backlogin') }}</span>
                </div>
            </form>
        </div>
    </AuthTemplate>
    <Template v-if="isShowResend === true">
        <div class="ah-rightside">
            <div>
                <h3 class="title-login dark-gray">{{$t('Auth.ResendEmail')}}</h3>
                <p class="GunPowder">{{$t('Auth.pleasecheck')}}</p>
            </div>
            <form action="#" @submit.prevent="handleSubmitResend">
                <div class="form-group">
                    <button  v-if="!isSpinner" class="btn btn-blue btn-login font-roboto-sans bg-blue white font-weight-500 cursor-pointer" type="submit">{{$t('Auth.ResendEmail')}}</button>
                    <button v-else type="button" class="btn btn-blue btn-login btn-disabled opacity-7 white bg-blue font-weight-500 font-roboto-sans" disabled><span id="btn-spinner"></span>{{ $t('Auth.loading') }}...</button>
                </div>
            </form>
            <div class="create-accountlink text-center">
                <span class="font-roboto-sans font-weight-normal font-weight-400 gray cursor-pointer" @click="backToLogin">{{$t('Auth.backlogin')}}? <span class="light-purple font-weight-500">{{$t('Auth.loging')}}</span></span>
            </div>
        </div>
    </Template>
</template>

<script setup>
// PACKAGES
import Cookies from 'js-cookie';
import {  defineComponent, inject, computed } from "vue";
import { useStore } from "vuex";

// COMPONENTS
import AuthTemplate from "@/components/templates/Authentication/index.vue";
import InputText from "@/components/atom/InputText/InputText.vue";
import { useRouter , useRoute} from 'vue-router'
import { useValidation } from "@/composable/Validation.js";
import { isAuthDeviderShow } from "@/composable/commonFunction.js";
import { ref , onMounted} from 'vue';
import {useToast} from 'vue-toast-notification';
import Template from "@/components/templates/Authentication/index.vue";
import { apiRequestWithoutCompnay, apiRequestWithoutSecure, getAuth } from '../../../services';
import { useI18n } from "vue-i18n";
const { t } = useI18n();
const $toast = useToast();
const errorMessage = ref("");
const rememberMe = ref(false)   
const submitted = ref(false)
const isSpinner = ref(false)
const isShowResend = ref(false);
// 2FA second-step state. When login returns twoFactorRequired we hide the
// password form and show this; submit2fa() exchanges tempToken + code at
// /api/v2/auth/2fa/validate for the real session.
const twoFactor = ref({ show: false, tempToken: '', code: '', error: '', isRecovery: false });
const userData = ref();
const router = useRouter()
const route = useRoute()
const  { checkErrors , checkAllFields } = useValidation();
import * as env from '@/config/env';
const axios = inject("$axios");
const isDevider = ref(isAuthDeviderShow());

// Demo mode — surfaces two one-click login buttons using the seeded demo
// accounts. `brandSettings.demoMode` is true only when the server has
// DEMO_MODE=true; on real deployments this stays hidden. The emails match
// what the DB-reset cron reseeds (owner@example.com / member@example.com).
const store = useStore();
const brandSettings = computed(() => store.getters['brandSettingTab/brandSettings'] || {});
const isDemoMode = computed(() => brandSettings.value.demoMode === true);
const DEMO_PASSWORD = 'Abc@1234';
const DEMO_OWNER_EMAIL = 'owner@example.com';
const DEMO_MEMBER_EMAIL = 'member@example.com';

defineComponent({
	name: "Login-Page",

	components: {
		AuthTemplate
	}
});

    const email = localStorage.getItem('ForgotEmail');

    const formData = ref({
        email: {
            value: email ? email : "",
            rules:
            "required | regex: ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$",
            name: "Email",
            error: "",
        },
        password: {
            value: "",
            rules:
            "required",
            name: "Password",
            error: "",
        },
    })
    const inputType = ref("password")

    const togglePasswordInput = () => {
        inputType.value = (inputType.value === "password") ? "text" : "password";
    }
    onMounted(() => {
        // Check remember me functionality
        var rem_data = localStorage.getItem("remember");
        var rem_array = JSON.parse(rem_data);
        if (rem_array) {
            var rem_email = rem_array.email;
            var rem_password = decode(rem_array.password);
            formData.value.email.value = rem_email;
            formData.value.password.value = rem_password;
            rememberMe.value = true;
        }
    })
    const handleForgotPassword = () => {
        localStorage.setItem("ForgotEmail", formData.value.email.value);
    }
    const encode = (source) => {
        var str = source;
        var length = str.length;
        var encodedStr = str.charCodeAt(0);
        var position = 1;
        while(position<length) {
            var n = str.charCodeAt(position++);
            encodedStr = encodedStr + ", " + n;
        }
        return encodedStr;
    }

    // //Decode user password
    const decode = (source) => {
        var source_array = source.split(','); // Convert string (CSV) to array.
        var decodedStr = String.fromCharCode.apply(null, source_array);
        return decodedStr;
    }

    //Update user status
    const updateUserStatus = (uid) => {
        return new Promise((resolve, reject) => {
                const updateObject = { 
                    'isOnline': true, 
                    'lastActive': new Date() 
                }

                apiRequestWithoutCompnay("put",env.USER_UPATE,{
                userId: uid,
                updateObject: updateObject,
            }).then(()=>{
                resolve(true)
            }).catch((err)=>{
                console.error(err);
                reject(false)
            })
        })
    }
    //Update user comapny check
    const userCompanyStatusCheck = (uid) => {
        return new Promise((resolve, reject) => {
            apiRequestWithoutCompnay("post",env.USER_AND_COMAPNY_CHECK,{userId:uid}).then((res)=>{
                resolve(res)
            }).catch((err)=>{
                console.error(err);
                reject(false)
            })
        })
    }
    const ownerLogin = () => {
        formData.value.email.value = DEMO_OWNER_EMAIL;
        formData.value.password.value = DEMO_PASSWORD;
        handleSubmit();
    }

    const memberLogin = () => {
        formData.value.email.value = DEMO_MEMBER_EMAIL;
        formData.value.password.value = DEMO_PASSWORD;
        handleSubmit();
    }

    //Hanlde login v4
    const handleSubmit = async () => {
        try {
            
            const valid = await checkAllFields(formData.value);
            if (!valid) return;

            document.getElementById('password').blur();
            document.getElementById('email').blur();
            submitted.value = true;

            const { email, password } = formData.value;
            const encodedPassword = encode(password.value);

            if (rememberMe.value) {
                localStorage.setItem("remember", JSON.stringify({
                    email: email.value,
                    password: encodedPassword,
                }));
            } else {
                localStorage.removeItem("remember");
            }

            isSpinner.value = true;

            const object = {
                email:email.value, 
                password:password.value,
                isLoginType: "frontend"
            }
            const user = await apiRequestWithoutSecure("post",env.LOGIN,object);
            
            if (user.status !== 200) {
                isSpinner.value = false;
                submitted.value = false;
                Cookies.remove('refreshToken');
                Cookies.remove('accessToken');
                $toast.error(t("Toast.something_went_wrong"), { position: 'top-right' });
                return; // Exit early
            }
            if(user?.data?.isResetPassword === true){
                isSpinner.value = false;
                submitted.value = false;
                Cookies.remove('refreshToken');
                Cookies.remove('accessToken');
                errorMessage.value = t("Toast.Password_reset_link");
                // $toast.warning(t("Toast.Password_reset_link"),{position: 'top-right'});
                return;
            }
            // 2FA second-step: the backend returns this (HTTP 200) instead of a
            // session when the account has TOTP enabled. Show the code form and
            // stop here; submit2fa() completes the login via /2fa/validate.
            if (user?.data?.twoFactorRequired === true && user?.data?.tempToken) {
                twoFactor.value.tempToken = user.data.tempToken;
                twoFactor.value.show = true;
                isSpinner.value = false;
                submitted.value = false;
                return;
            }
            const userId = user.data.uid;
            await proceedAfterAuth(userId);

        } catch (error) {
            console.error(error);
            isSpinner.value = false;
            submitted.value = false;
            localStorage.removeItem("updateToken");
            Cookies.remove('refreshToken');
            Cookies.remove('accessToken');
            if(error?.response?.data?.isEmailVerified === false && error?.response?.data?.userData) {
                userData.value = error?.response?.data?.userData;
            }

            if (error?.response?.data?.isEmailVerified === false) {
                $toast.error(t('Auth.verify_email_and_try_again'), { position: 'top-right' });
                isShowResend.value = true;
            } else if(error?.response?.data?.message === "Your email is invalid. Please check and try again" || error?.response?.data?.message === 'User not found' ){
                $toast.error(t("Toast.Invalid_email"), { position: 'top-right' });
            } else if(error?.response?.data?.message === "Your password is invalid. Please check and try again"){
                $toast.error(t("Toast.Invalid_password"), { position: 'top-right' });
            } else if(error?.response?.data?.message === "Auth.too_many_request"){
                $toast.error(t("Toast.Too_many_request"), { position: 'top-right' });
            } else if (error.error === 'invalid username/password' || error.error_code === 'InvalidPassword') {
                $toast.error(t("Toast.Invalid_username_or_password"), { position: 'top-right' });
            } else if (error.message === "Email Not Verified") {
                $toast.error(t("Toast.Email_Not_Verified"), { position: 'top-right' });
                isShowResend.value = true;
            } else {
                $toast.error(t("Toast.something_went_wrong"), { position: 'top-right' });
            }

            localStorage.removeItem("userId");
            localStorage.removeItem("isLogging");
            localStorage.removeItem("remember");
        }
    };

    // Shared post-authentication flow: company-status check, token refresh,
    // email-verification gate, company selection, and redirect. Runs for both
    // password login and the 2FA second-step so they behave identically.
    const proceedAfterAuth = async (userId) => {
        localStorage.setItem("userId", userId);
        const [userResponse] = await Promise.all([
            userCompanyStatusCheck(userId),
            getAuth(userId, true)
        ]);

        userData.value = userResponse?.data?.data.userData;
        if(userResponse.data.status == false) {
            isSpinner.value = false;
            submitted.value = false;
            localStorage.removeItem("updateToken");
            Cookies.remove('refreshToken');
            Cookies.remove('accessToken');
            throw new Error('MongoDB Error from Api')
        }

        const {userData: uData, companyId: companyID, isCompanyFind} = userResponse.data.data;
        let cid = localStorage.getItem("selectedCompany") ?? companyID;
        if (!uData.isEmailVerified) {
            isSpinner.value = false;
            submitted.value = false;
            localStorage.removeItem("updateToken");
            Cookies.remove('refreshToken');
            Cookies.remove('accessToken');
            throw new Error("Verify your email and try again");
        }

        localStorage.setItem('SubmenuScreen', 'project');

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

        localStorage.setItem("isLogging", "true");

        if (route.query.redirect_url && route.query.redirect_url !== '/login') {
            if(route.query.redirect_url === "/") {
                await router.replace(`${route.query.redirect_url}${cid}`);
            } else {
                const tmpcid = route.query.redirect_url?.split("/")[1];
                if ((tmpcid && uData.AssignCompany.includes(tmpcid)) || tmpcid === 'oauth2') {
                    await router.replace(route.query.redirect_url );
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
        submitted.value = false;
        localStorage.removeItem('ForgotEmail');
    };

    // 2FA second-step submit: exchange tempToken + code (TOTP or recovery) for a
    // real session, then run the same post-auth flow as a password login.
    const submit2fa = async () => {
        try {
            if (!twoFactor.value.code || !twoFactor.value.code.trim()) {
                twoFactor.value.error = t('Auth.two_factor_enter_code');
                return;
            }
            twoFactor.value.error = '';
            isSpinner.value = true;
            submitted.value = true;
            const res = await apiRequestWithoutSecure("post", env.TWO_FA_VALIDATE, {
                tempToken: twoFactor.value.tempToken,
                code: twoFactor.value.code.trim(),
            });
            if (res.status !== 200 || !res?.data?.uid) {
                isSpinner.value = false;
                submitted.value = false;
                twoFactor.value.error = t('Auth.two_factor_invalid_code');
                return;
            }
            await proceedAfterAuth(res.data.uid);
        } catch (error) {
            console.error(error);
            isSpinner.value = false;
            submitted.value = false;
            const msg = error?.response?.data?.message;
            if (msg === 'Auth.too_many_request') {
                twoFactor.value.error = t('Toast.Too_many_request');
            } else if (typeof msg === 'string' && /expired/i.test(msg)) {
                // tempToken expired — send the user back to the password step.
                twoFactor.value.error = '';
                backToLoginFrom2fa();
                $toast.error(t('Auth.two_factor_session_expired'), { position: 'top-right' });
            } else {
                twoFactor.value.error = t('Auth.two_factor_invalid_code');
            }
        }
    };

    const toggleRecoveryMode = () => {
        twoFactor.value.isRecovery = !twoFactor.value.isRecovery;
        twoFactor.value.code = '';
        twoFactor.value.error = '';
    };
    const backToLoginFrom2fa = () => {
        twoFactor.value = { show: false, tempToken: '', code: '', error: '', isRecovery: false };
    };

    const handleSubmitResend = () => {
        if (!(userData.value && Object.keys(userData.value).length)) {
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
            return;
        }

        const cTime = Date.now();
        const duration = 1 * 60 * 1000;
        const lastResendTime = localStorage.getItem("lastResendTime");

        if (lastResendTime && cTime - lastResendTime < duration) {
            $toast.error(t(`authErrorMessage.please_wait_before_resending_email`), { position: 'top-right' });
            return;
        }
        const axiosData = {
            "uid": userData.value._id,
            "email": userData.value.Employee_Email
        };
        isSpinner.value = true;
        axios.post(env.API_URI + env.SEND_VARIFICATION_EMAIL, axiosData).then((result) => {
            if(result.data.status === true) {
                $toast.success(t("Toast.Verification_mail_has_been_send_successfully"),{position: 'top-right'});
                localStorage.setItem("lastResendTime", cTime.toString());
                isSpinner.value = false;
            } else {
                isSpinner.value = false;
                $toast.error(result.data.statusText,{position: 'top-right'});
            }
        }).catch((error) => {
            isSpinner.value = false;
            console.error(error,"Error");
            $toast.error(t("Toast.something_went_wrong"), { position: 'top-right' });
        })
    }

    const backToLogin = () => {
        localStorage.removeItem("lastResendTime");
        isShowResend.value = false;
    }
    const handleChange = () => {
        localStorage.setItem("ForgotEmail", formData.value.email.value);
    }
</script>
<style>
.login-info-message {
    background: #ffa500;
    font-weight: 500 !important;
    padding: 5px;
    color: #2c2c2c !important;
}
.load {
  display: flex;
  border-radius: 50%;
  flex-direction: row;
}

.progress {
  width: 0.6em;
  height: 0.6em;
  margin: 0.2em;
  scale: 0;
  border-radius: 50%;
  background: rgb(255, 255, 255);
  animation: loading_492 0.9s ease infinite;
  animation-delay: 0s;
}

@keyframes loading_492 {
  50% {
    scale: 1;
  }
}

.progress:nth-child(2) {
  animation-delay: 0.3s;
}

.progress:nth-child(3) {
  animation-delay: 0.6s;
}

.demo-login-buttons {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 12px;
}
.btn-demo-login {
    background: #fff;
    color: #2f3990;
    border: 1px solid #2f3990;
    height: 48px;
}
.btn-demo-login:hover {
    background: #f4f5ff;
}
</style>
<style src="./style.css">
</style>