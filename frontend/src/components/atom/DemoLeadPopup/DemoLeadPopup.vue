<template>
    <Teleport to="body">
        <div v-if="isOpen" class="demo-lead" @click.self="close">
            <div class="demo-lead__modal" role="dialog" aria-modal="true" aria-labelledby="demo-lead-title">
                <button type="button" class="demo-lead__close" :aria-label="$t('Demo.lead_close')" @click="close">&times;</button>

                <template v-if="!isDone">
                    <h3 id="demo-lead-title" class="demo-lead__title">{{ $t('Demo.lead_title') }}</h3>
                    <p class="demo-lead__subtitle">{{ $t('Demo.lead_subtitle') }}</p>

                    <form novalidate @submit.prevent="submit">
                        <div class="ah-field">
                            <label class="ah-field__label" for="demo-lead-name">{{ $t('Demo.lead_name') }}</label>
                            <input id="demo-lead-name" ref="nameInput" v-model="form.name" type="text" maxlength="100" class="ah-input" :class="{ 'ah-input--error': errors.name }" autocomplete="name">
                            <div v-if="errors.name" class="ah-field__error">{{ errors.name }}</div>
                        </div>

                        <div class="ah-field">
                            <label class="ah-field__label" for="demo-lead-email">{{ $t('Demo.lead_email') }}</label>
                            <input id="demo-lead-email" v-model="form.email" type="email" maxlength="254" class="ah-input" :class="{ 'ah-input--error': errors.email }" autocomplete="email">
                            <div v-if="errors.email" class="ah-field__error">{{ errors.email }}</div>
                        </div>

                        <div class="ah-field">
                            <label class="ah-field__label" for="demo-lead-find">{{ $t('Demo.lead_find_from') }}</label>
                            <select id="demo-lead-find" v-model="form.findFrom" class="ah-input" :class="{ 'ah-input--error': errors.findFrom }">
                                <option value="">{{ $t('Demo.lead_find_from_placeholder') }}</option>
                                <option v-for="option in EVENT_OPTIONS" :key="option" :value="option">{{ option }}</option>
                                <option :value="OTHER">{{ $t('Demo.lead_find_from_other') }}</option>
                            </select>
                            <input
                                v-if="form.findFrom === OTHER"
                                v-model="form.findFromOther"
                                type="text"
                                maxlength="200"
                                class="ah-input demo-lead__other"
                                :placeholder="$t('Demo.lead_other_placeholder')"
                            >
                            <div v-if="errors.findFrom" class="ah-field__error">{{ errors.findFrom }}</div>
                        </div>

                        <div v-if="submitFailed" class="ah-field__error">{{ $t('Demo.lead_failed') }}</div>

                        <button type="submit" class="ah-btn ah-btn--primary ah-btn--block demo-lead__submit" :disabled="isSubmitting">
                            {{ isSubmitting ? $t('Demo.lead_submitting') : $t('Demo.lead_submit') }}
                        </button>
                    </form>
                </template>

                <p v-else class="demo-lead__thanks">{{ $t('Demo.lead_thanks') }}</p>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { apiRequestWithoutSecure } from "@/services";
import * as env from "@/config/env";

const EVENT_OPTIONS = [
    'BTE (event)',
    'AVAR (Hyderabad)',
    'Bengaluru Tech Summit',
    'BFSI Innovation and Technology Summit (Mumbai)',
    'Bharat AI Innovation (Mumbai)',
    'Cypher (Bengaluru)',
    'DataHack Summit (Bengaluru)',
    'Deccan Queen on Rails (Pune)',
    'Devcon (Mumbai)',
    'DevFest Lucknow',
    'DevSparks',
    'droidCon India (Bengaluru)',
    'Future Makers Conclave (Bengaluru)',
    'Gartner Data & Analytics Summit (Mumbai)',
    'Gartner IT Symposium/Xpo (Kochi)',
    'GeoSmart India (New Delhi)',
    'Global Technology Summit (New Delhi)',
    'Hyderabad AI Cybercon',
    'Hyderabad Postgres Days',
    'India AI Impact Summit (New Delhi)',
    'India-US Tech Conclave (Bengaluru)',
    'IndiaFOSS (Bengaluru)',
    'Information Technology Conference (Delhi)',
    'RubyConf India (Hyderabad)',
    'Swift Bharat (Mumbai)',
    'TiEcon Delhi-NCR',
    'Workplace Ninjas India (Delhi)',
];
// The backend keys the free-text field off this exact value.
const OTHER = 'Other';
const SEEN_KEY = 'demoLeadPopupSeen';
const OPEN_DELAY_MS = 1500;
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$/;

const { t } = useI18n();
const store = useStore();
const demoMode = computed(() => (store.getters['brandSettingTab/brandSettings'] || {}).demoMode === true);

const isOpen = ref(false);
const isDone = ref(false);
const isSubmitting = ref(false);
const submitFailed = ref(false);
const nameInput = ref(null);
const form = ref({ name: '', email: '', findFrom: '', findFromOther: '' });
const errors = ref({ name: '', email: '', findFrom: '' });

let openTimer = null;
let closeTimer = null;

// localStorage throws in private mode or with blocked storage; the popup must never break the login page.
const hasSeen = () => {
    try {
        return localStorage.getItem(SEEN_KEY) === '1';
    } catch (e) {
        return false;
    }
};
const markSeen = () => {
    try {
        localStorage.setItem(SEEN_KEY, '1');
    } catch (e) { /* ignore */ }
};

const onKeydown = (event) => {
    if (event.key === 'Escape') close();
};

const open = () => {
    if (hasSeen()) return;
    isOpen.value = true;
    document.addEventListener('keydown', onKeydown);
    nextTick(() => nameInput.value && nameInput.value.focus());
};

const close = () => {
    markSeen();
    isOpen.value = false;
    document.removeEventListener('keydown', onKeydown);
};

watch(demoMode, (isDemo) => {
    if (isDemo && !openTimer && !hasSeen()) {
        openTimer = setTimeout(open, OPEN_DELAY_MS);
    }
}, { immediate: true });

const validate = () => {
    errors.value.name = form.value.name.trim() ? '' : t('Demo.lead_name_required');
    errors.value.email = EMAIL_RE.test(form.value.email.trim()) ? '' : t('Demo.lead_email_invalid');
    errors.value.findFrom = form.value.findFrom ? '' : t('Demo.lead_find_from_required');
    return !errors.value.name && !errors.value.email && !errors.value.findFrom;
};

const submit = () => {
    if (isSubmitting.value || !validate()) return;
    isSubmitting.value = true;
    submitFailed.value = false;
    apiRequestWithoutSecure('post', env.DEMO_LEADS, {
        name: form.value.name.trim(),
        email: form.value.email.trim(),
        findFrom: form.value.findFrom,
        findFromOther: form.value.findFrom === OTHER ? form.value.findFromOther.trim() : '',
        page: window.location.href,
    }).then(() => {
        isDone.value = true;
        markSeen();
        closeTimer = setTimeout(close, 1500);
    }).catch(() => {
        submitFailed.value = true;
    }).finally(() => {
        isSubmitting.value = false;
    });
};

onBeforeUnmount(() => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    document.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
.demo-lead {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: var(--scrim);
    font-family: var(--font-ui);
}
.demo-lead__modal {
    position: relative;
    width: 100%;
    max-width: 420px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-modal);
    padding: 28px 24px 24px;
    box-shadow: var(--shadow-modal);
    color: var(--ink);
}
.demo-lead__close {
    position: absolute;
    top: 8px;
    right: 12px;
    border: 0;
    background: transparent;
    font-size: 26px;
    line-height: 1;
    color: var(--ink-3);
    cursor: pointer;
}
.demo-lead__close:hover {
    color: var(--ink);
}
.demo-lead__title {
    margin: 0 0 6px;
    font-size: var(--text-h2);
    font-weight: var(--fw-strong);
}
.demo-lead__subtitle {
    margin: 0 0 18px;
    color: var(--ink-2);
}
.demo-lead .ah-field {
    margin-bottom: 12px;
}
.demo-lead__other {
    margin-top: 8px;
}
.demo-lead__submit {
    margin-top: 8px;
}
.demo-lead__thanks {
    margin: 12px 0 4px;
    font-size: var(--text-h3);
    text-align: center;
    color: var(--brand);
}
</style>
