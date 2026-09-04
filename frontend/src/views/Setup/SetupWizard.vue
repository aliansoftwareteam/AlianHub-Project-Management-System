<template>
    <AuthShell :proof="false">
        <template #top-right>
            <a :href="guide('first-run')" target="_blank" rel="noopener">{{ $t('Setup.guide_link') }}</a>
        </template>

        <div v-if="step === 'checking'" class="setup__center">
            <span class="ah-spin"></span>
            <p class="auth__p">{{ $t('Setup.checking') }}</p>
        </div>

        <div v-else-if="step === 'blocked'">
            <div class="auth__glyph auth__glyph--warn">!</div>
            <h1 class="auth__title">{{ $t('Setup.db_title') }}</h1>
            <p class="auth__lead">{{ $t('Setup.db_lead') }}</p>
            <div class="auth__banner auth__banner--danger"><ShellIcon name="alert" :size="15" /><span class="ah-mono">{{ status.dbError }}</span></div>
            <ol class="setup__steps">
                <li>{{ $t('Setup.db_step_env') }} <code class="ah-mono">MONGODB_URL</code></li>
                <li>{{ $t('Setup.db_step_restart') }}</li>
                <li>{{ $t('Setup.db_step_retry') }}</li>
            </ol>
            <div class="auth__actions">
                <button type="button" class="ah-btn ah-btn--primary" :disabled="busy" @click="loadStatus">{{ $t('Setup.retry') }}</button>
                <a class="ah-btn ah-btn--secondary" :href="guide('install')" target="_blank" rel="noopener">{{ $t('Setup.open_guide') }}</a>
            </div>
        </div>

        <form v-else-if="step === 'form'" novalidate @submit.prevent="submit">
            <span class="ah-chip ah-chip--mono auth__step">{{ $t('Setup.version', { version: status.version }) }}</span>
            <h1 class="auth__title">{{ $t('Setup.title') }}</h1>
            <p class="auth__lead">{{ $t('Setup.lead') }}</p>

            <div v-if="banner" class="auth__banner auth__banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ banner }}</span></div>

            <div class="auth__fields">
                <div class="setup__row">
                    <div class="ah-field">
                        <label class="ah-field__label" for="firstName">{{ $t('Setup.first_name') }}</label>
                        <input id="firstName" v-model.trim="form.firstName" type="text" maxlength="60" autocomplete="given-name" class="ah-input" :class="{ 'ah-input--error': errors.firstName }" @input="errors.firstName = ''" />
                        <div v-if="errors.firstName" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.firstName }}</div>
                    </div>
                    <div class="ah-field">
                        <label class="ah-field__label" for="lastName">{{ $t('Setup.last_name') }}</label>
                        <input id="lastName" v-model.trim="form.lastName" type="text" maxlength="60" autocomplete="family-name" class="ah-input" :class="{ 'ah-input--error': errors.lastName }" @input="errors.lastName = ''" />
                        <div v-if="errors.lastName" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.lastName }}</div>
                    </div>
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="email">{{ $t('Setup.email') }}</label>
                    <input id="email" v-model.trim="form.email" type="email" maxlength="254" autocomplete="username" class="ah-input" :class="{ 'ah-input--error': errors.email }" @input="form.email = form.email.toLowerCase(); errors.email = ''" />
                    <div v-if="errors.email" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.email }}</div>
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="password">{{ $t('Setup.password') }}</label>
                    <div class="auth__pw">
                        <input id="password" v-model="form.password" :type="showPassword ? 'text' : 'password'" maxlength="150" autocomplete="new-password" class="ah-input" :class="{ 'ah-input--error': errors.password }" placeholder="••••••••" @input="errors.password = ''" />
                        <button type="button" class="auth__pw-eye" :aria-label="showPassword ? $t('Setup.hide_password') : $t('Setup.show_password')" @click="showPassword = !showPassword">
                            <ShellIcon :name="showPassword ? 'eyeOff' : 'eye'" :size="15" />
                        </button>
                    </div>
                    <div v-if="errors.password" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.password }}</div>
                    <span v-else class="ah-small">{{ $t('Setup.password_hint', { n: MIN_PASSWORD }) }}</span>
                </div>

                <hr class="ah-divider" />

                <div class="ah-field">
                    <label class="ah-field__label" for="companyName">{{ $t('Setup.company') }}</label>
                    <input id="companyName" v-model.trim="form.companyName" type="text" maxlength="120" autocomplete="organization" class="ah-input" :class="{ 'ah-input--error': errors.companyName }" @input="errors.companyName = ''" />
                    <div v-if="errors.companyName" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ errors.companyName }}</div>
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="teamFocus">{{ $t('Setup.focus') }}</label>
                    <select id="teamFocus" v-model="form.teamFocus" class="ah-input">
                        <option value="">{{ $t('Setup.focus_unsure') }}</option>
                        <option value="software">{{ $t('Setup.focus_software') }}</option>
                        <option value="marketing">{{ $t('Setup.focus_marketing') }}</option>
                        <option value="design">{{ $t('Setup.focus_design') }}</option>
                        <option value="support">{{ $t('Setup.focus_support') }}</option>
                        <option value="hiring">{{ $t('Setup.focus_hiring') }}</option>
                        <option value="other">{{ $t('Setup.focus_other') }}</option>
                    </select>
                    <span class="ah-small">{{ $t('Setup.focus_hint') }}</span>
                </div>
                <label class="setup__toggle">
                    <input v-model="form.sampleData" type="checkbox" class="ah-check" />
                    <span>
                        <strong>{{ $t('Setup.sample_title') }}</strong>
                        <span class="ah-small">{{ $t('Setup.sample_hint') }}</span>
                    </span>
                </label>
            </div>

            <div class="auth__actions">
                <button type="submit" class="ah-btn ah-btn--primary ah-btn--lg" :disabled="busy">
                    <span v-if="busy" class="ah-spin"></span>{{ busy ? $t('Setup.working') : $t('Setup.create') }}
                </button>
            </div>
            <p class="auth__hint">{{ $t('Setup.owner_note') }}</p>
        </form>

        <div v-else-if="step === 'progress'">
            <h2 class="auth__h">{{ $t('Setup.progress_title') }}</h2>
            <p class="auth__p">{{ $t('Setup.progress_lead') }}</p>
            <ul class="setup__progress" aria-live="polite">
                <li v-for="item in progressItems" :key="item.key" :class="{ 'is-done': item.done, 'is-active': item.active }">
                    <ShellIcon v-if="item.done" name="check" :size="14" />
                    <span v-else-if="item.active" class="ah-spin ah-spin--sm"></span>
                    <span v-else class="setup__dot"></span>
                    <span>{{ $t(`Setup.progress_${item.key}`) }}</span>
                </li>
            </ul>
        </div>

        <div v-else-if="step === 'failed'">
            <div class="auth__glyph auth__glyph--warn">!</div>
            <h2 class="auth__h">{{ $t('Setup.failed_title') }}</h2>
            <p class="auth__p">{{ $t('Setup.failed_lead') }}</p>
            <div class="auth__banner auth__banner--danger"><ShellIcon name="alert" :size="15" /><span class="ah-mono">{{ banner }}</span></div>
            <div class="auth__actions">
                <button type="button" class="ah-btn ah-btn--primary" @click="loadStatus">{{ $t('Setup.retry') }}</button>
                <a class="ah-btn ah-btn--secondary" :href="guide('troubleshooting')" target="_blank" rel="noopener">{{ $t('Setup.open_guide') }}</a>
            </div>
        </div>

        <div v-else-if="step === 'done'" class="setup__center">
            <div class="auth__glyph auth__glyph--brand">✓</div>
            <h2 class="auth__h">{{ $t('Setup.done_title') }}</h2>
            <p class="auth__p">{{ $t('Setup.done_lead') }}</p>
        </div>
    </AuthShell>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import Cookies from "js-cookie";
import AuthShell from "@/components/templates/AuthShell/AuthShell.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequestWithoutSecure, getAuth } from "@/services";
import * as env from "@/config/env";
import { readSetupStatus, markInstalled } from "@/router/setupStatus";

defineOptions({ name: "SetupWizard" });

const { t } = useI18n();
const router = useRouter();

const PROGRESS_KEYS = ["seeds", "account", "company", "settings", "sample"];
const MIN_PASSWORD = 8;

const step = ref("checking");
const status = ref({});
const busy = ref(false);
const banner = ref("");
const showPassword = ref(false);
const reached = ref("");
const form = reactive({ firstName: "", lastName: "", email: "", password: "", companyName: "", teamFocus: "", sampleData: true });
const errors = reactive({ firstName: "", lastName: "", email: "", password: "", companyName: "" });
let events = null;

const guide = (anchor) => `${env.ADMIN_GUIDE_URL}#${anchor}`;

const progressItems = computed(() => {
    const index = PROGRESS_KEYS.indexOf(reached.value);
    return PROGRESS_KEYS
        .filter((key) => key !== "sample" || form.sampleData)
        .map((key, i) => ({ key, done: index > i || step.value === "done", active: index === i && step.value !== "done" }));
});

async function loadStatus() {
    step.value = "checking";
    busy.value = true;
    const s = await readSetupStatus({ force: true });
    busy.value = false;
    status.value = s || {};
    if (!s) { status.value = { dbError: t("Setup.server_unreachable") }; step.value = "blocked"; return; }
    if (s.installed) { router.replace({ name: "Log-in" }); return; }
    step.value = s.dbOk ? "form" : "blocked";
}

const serverError = (key) => ({
    required: t("Setup.err_required"),
    invalid: t("Setup.err_invalid"),
    [`min_${MIN_PASSWORD}`]: t("Setup.err_password", { n: MIN_PASSWORD }),
}[key] || key);

function validate() {
    Object.keys(errors).forEach((k) => { errors[k] = ""; });
    if (!form.firstName) errors.firstName = serverError("required");
    if (!form.lastName) errors.lastName = serverError("required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = serverError("invalid");
    if (form.password.length < MIN_PASSWORD) errors.password = serverError(`min_${MIN_PASSWORD}`);
    if (!form.companyName) errors.companyName = serverError("required");
    return !Object.values(errors).some(Boolean);
}

function listen(eventId) {
    closeEvents();
    events = new EventSource(`${env.API_URI}${env.SETUP_EVENTS}/${eventId}`);
    events.onmessage = (message) => {
        try {
            const { data } = JSON.parse(message.data);
            if (data?.step && data.step !== 100) reached.value = data.step;
        } catch (e) { /* a malformed event only delays the progress display */ }
    };
}

function closeEvents() {
    if (events) { events.close(); events = null; }
}

async function submit() {
    if (!validate()) return;
    banner.value = "";
    busy.value = true;
    const eventId = `setup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    listen(eventId);
    step.value = "progress";
    reached.value = "seeds";
    try {
        const res = await apiRequestWithoutSecure("post", env.SETUP_COMPLETE, { ...form, eventId });
        const data = res?.data?.data || {};
        if (res?.data?.status !== true || !data.userId) throw new Error(res?.data?.statusText || t("Setup.failed_generic"));
        markInstalled();
        step.value = "done";
        await enter(data);
    } catch (error) {
        const body = error?.response?.data || {};
        if (body?.data?.errors) {
            Object.entries(body.data.errors).forEach(([k, v]) => { if (k in errors) errors[k] = serverError(v); });
            step.value = "form";
        } else {
            banner.value = body.statusText || error.message || t("Setup.failed_generic");
            step.value = "failed";
        }
    } finally {
        closeEvents();
        busy.value = false;
    }
}

async function enter({ userId, companyId, accessToken, refreshToken, session }) {
    if (!session) { router.replace({ name: "Log-in" }); return; }
    if (accessToken) Cookies.set("accessToken", accessToken);
    if (refreshToken) Cookies.set("refreshToken", refreshToken);
    localStorage.setItem("userId", userId);
    localStorage.setItem("selectedCompany", companyId);
    localStorage.setItem("isLogging", "true");
    localStorage.setItem("SubmenuScreen", "project");
    try { await getAuth(userId, true); } catch (e) { router.replace({ name: "Log-in" }); return; }
    window.location.assign(`${window.location.origin}/#/${companyId}`);
    window.location.reload();
}

onMounted(loadStatus);
onUnmounted(closeEvents);
</script>

<style scoped>
.setup__center { display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; padding: 24px 0; }
.setup__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.setup__steps { margin: 16px 0 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; color: var(--ink-2); font: var(--text-body); }
.setup__steps code { padding: 1px 5px; border-radius: 4px; background: var(--surface-hover); }
.setup__toggle { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; }
.setup__toggle > span { display: flex; flex-direction: column; gap: 2px; }
.setup__progress { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.setup__progress li { display: flex; align-items: center; gap: 10px; color: var(--ink-3); }
.setup__progress li.is-active { color: var(--ink); }
.setup__progress li.is-done { color: var(--ok-ink); }
.setup__dot { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--border); flex: none; }
.ah-spin--sm { width: 14px; height: 14px; }
@media (max-width: 520px) { .setup__row { grid-template-columns: 1fr; } }
</style>
