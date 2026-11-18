<template>
    <Teleport to="body">
        <div v-if="isOpen" class="demo-lead-overlay" @click.self="close">
            <div class="demo-lead-modal" role="dialog" aria-modal="true" aria-labelledby="demo-lead-title">
                <button type="button" class="demo-lead-close" :aria-label="$t('Demo.lead_close')" @click="close">&times;</button>

                <template v-if="!isDone">
                    <h3 id="demo-lead-title" class="demo-lead-title">{{ $t('Demo.lead_title') }}</h3>
                    <p class="demo-lead-subtitle">{{ $t('Demo.lead_subtitle') }}</p>

                    <form novalidate @submit.prevent="submit">
                        <label class="demo-lead-label" for="demo-lead-name">{{ $t('Demo.lead_name') }} <span class="demo-lead-req">*</span></label>
                        <input id="demo-lead-name" ref="nameInput" v-model="form.name" type="text" maxlength="100" class="demo-lead-input" autocomplete="name">
                        <div v-if="errors.name" class="demo-lead-error">{{ errors.name }}</div>

                        <label class="demo-lead-label" for="demo-lead-email">{{ $t('Demo.lead_email') }} <span class="demo-lead-req">*</span></label>
                        <input id="demo-lead-email" v-model="form.email" type="email" maxlength="254" class="demo-lead-input" autocomplete="email">
                        <div v-if="errors.email" class="demo-lead-error">{{ errors.email }}</div>

                        <label class="demo-lead-label" for="demo-lead-find">{{ $t('Demo.lead_find_from') }} <span class="demo-lead-req">*</span></label>
                        <select id="demo-lead-find" v-model="form.findFrom" class="demo-lead-input">
                            <option value="">{{ $t('Demo.lead_find_from_placeholder') }}</option>
                            <option v-for="option in EVENT_OPTIONS" :key="option" :value="option">{{ option }}</option>
                            <option value="Other">Other</option>
                        </select>
                        <input
                            v-if="form.findFrom === 'Other'"
                            v-model="form.findFromOther"
                            type="text"
                            maxlength="200"
                            class="demo-lead-input demo-lead-other"
                            :placeholder="$t('Demo.lead_other_placeholder')"
                        >
                        <div v-if="errors.findFrom" class="demo-lead-error">{{ errors.findFrom }}</div>

                        <div v-if="submitFailed" class="demo-lead-error demo-lead-failed">{{ $t('Demo.lead_failed') }}</div>

                        <button type="submit" class="demo-lead-submit" :disabled="isSubmitting">
                            {{ isSubmitting ? $t('Demo.lead_submitting') : $t('Demo.lead_submit') }}
                        </button>
                    </form>
                </template>

                <p v-else class="demo-lead-thanks">{{ $t('Demo.lead_thanks') }}</p>
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

// localStorage can throw in private mode or with blocked storage; the popup must never break the page.
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
    } catch (e) {
        // ignore
    }
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
        findFromOther: form.value.findFrom === 'Other' ? form.value.findFromOther.trim() : '',
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
.demo-lead-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.5);
    font-family: Roboto, sans-serif;
}
.demo-lead-modal {
    position: relative;
    width: 100%;
    max-width: 420px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    background: #fff;
    border-radius: 10px;
    padding: 28px 24px 24px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    color: #1d1d1d;
}
.demo-lead-close {
    position: absolute;
    top: 8px;
    right: 12px;
    border: 0;
    background: transparent;
    font-size: 26px;
    line-height: 1;
    color: #6b6b6b;
    cursor: pointer;
}
.demo-lead-close:hover {
    color: #1d1d1d;
}
.demo-lead-title {
    margin: 0 0 6px;
    font-size: 20px;
    font-weight: 600;
    color: #2f3990;
}
.demo-lead-subtitle {
    margin: 0 0 18px;
    font-size: 14px;
    color: #5f5f5f;
}
.demo-lead-label {
    display: block;
    margin: 12px 0 6px;
    font-size: 13px;
    font-weight: 500;
}
.demo-lead-req {
    color: #e53935;
}
.demo-lead-input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    height: 40px;
    padding: 8px 12px;
    border: 1px solid #cfd2dc;
    border-radius: 6px;
    background: #fff;
    font-size: 14px;
    font-family: inherit;
    color: inherit;
}
.demo-lead-input:focus {
    outline: none;
    border-color: #2f3990;
}
.demo-lead-other {
    margin-top: 8px;
}
.demo-lead-error {
    margin-top: 4px;
    font-size: 12px;
    color: #e53935;
}
.demo-lead-failed {
    margin-top: 14px;
}
.demo-lead-submit {
    width: 100%;
    height: 42px;
    margin-top: 20px;
    border: 0;
    border-radius: 6px;
    background: #2f3990;
    color: #fff;
    font-size: 15px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
}
.demo-lead-submit:disabled {
    opacity: 0.7;
    cursor: default;
}
.demo-lead-thanks {
    margin: 12px 0 4px;
    font-size: 16px;
    text-align: center;
    color: #2f3990;
}
</style>
