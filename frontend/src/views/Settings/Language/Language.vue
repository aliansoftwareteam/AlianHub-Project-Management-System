<template>
    <div class="ah-page lang">
        <div>
            <h2 class="ah-h3">{{ $t('Language.title') }}</h2>
            <p class="lang__intro">{{ $t('Language.subtitle') }}</p>
        </div>

        <div class="ah-card">
            <div class="ah-card__body">
                <div class="ah-label">{{ $t('Language.language_heading', { count: locales.length }) }}</div>
                <div class="lang__grid" style="margin-top: 9px">
                    <button
                        v-for="locale in locales"
                        :key="locale.code"
                        type="button"
                        class="lang__option"
                        :class="{ 'is-active': form.language === locale.code }"
                        :lang="locale.code"
                        :dir="locale.dir"
                        @click="form.language = locale.code"
                    >
                        <span>{{ locale.label }}</span>
                        <span v-if="locale.dir === 'rtl'" class="lang__rtl-tag">RTL</span>
                    </button>
                </div>

                <div class="lang__row">
                    <label class="lang__row-label" for="lang-date">{{ $t('Language.date_format') }}</label>
                    <select id="lang-date" v-model="form.dateFormat" class="ah-input">
                        <option v-for="format in dateFormats" :key="format" :value="format">{{ format }}</option>
                    </select>
                    <label class="lang__row-label" for="lang-week">{{ $t('Language.week_starts') }}</label>
                    <select id="lang-week" v-model="form.weekStart" class="ah-input">
                        <option v-for="day in weekStarts" :key="day" :value="day">{{ $t('Language.' + day) }}</option>
                    </select>
                </div>

                <div class="lang__row">
                    <label class="lang__row-label" for="lang-numbers">{{ $t('Language.numbers') }}</label>
                    <select id="lang-numbers" v-model="form.numberFormat" class="ah-input">
                        <option v-for="format in numberFormats" :key="format" :value="format">{{ format }}</option>
                    </select>
                    <label class="lang__row-label" for="lang-numerals">{{ $t('Language.numerals') }}</label>
                    <select id="lang-numerals" v-model="form.numerals" class="ah-input">
                        <option v-for="system in numeralSystems" :key="system.key" :value="system.key">{{ system.sample }}</option>
                    </select>
                    <label class="lang__row-label" for="lang-currency">{{ $t('Language.currency') }}</label>
                    <select id="lang-currency" v-model="form.currency" class="ah-input">
                        <option v-for="code in currencies" :key="code" :value="code">{{ code }}</option>
                    </select>
                </div>
            </div>
        </div>

        <div class="lang__previews">
            <div class="ah-card" dir="ltr">
                <div class="ah-card__body lang__preview">
                    <div class="ah-label">LTR</div>
                    <div class="lang__task">
                        <span class="lang__task-box"></span>
                        <span class="lang__task-name">{{ $t('Language.sample_task_en') }}</span>
                        <span class="ah-avatar ah-avatar--sm">P</span>
                    </div>
                    <div class="lang__meta">
                        <span class="ah-ltr">{{ sampleDateLatin }}</span>
                        <span class="lang__meta-end">{{ sampleMoneyLatin }}</span>
                    </div>
                    <div class="lang__chips">
                        <span class="ah-chip ah-chip--brand">{{ $t('Language.sample_status_en') }}</span>
                        <span class="ah-chip ah-chip--warn">{{ $t('Language.sample_priority_en') }}</span>
                    </div>
                </div>
            </div>

            <div class="ah-card lang__preview--rtl" dir="rtl">
                <div class="ah-card__body lang__preview">
                    <div class="ah-label">{{ $t('Language.preview_rtl') }}</div>
                    <div class="lang__task">
                        <span class="lang__task-box"></span>
                        <span class="lang__task-name">{{ rtlSampleTask }}</span>
                        <span class="ah-avatar ah-avatar--sm">P</span>
                    </div>
                    <div class="lang__meta">
                        <span>{{ sampleDateArab }}</span>
                        <span class="lang__meta-end">{{ sampleMoneyArab }}</span>
                    </div>
                    <div class="lang__chips">
                        <span class="ah-chip ah-chip--brand">{{ rtlSampleStatus }}</span>
                        <span class="ah-chip ah-chip--warn">{{ rtlSamplePriority }}</span>
                    </div>
                    <div class="lang__meta">
                        <span class="ah-label">{{ $t('Language.timer_never_flips') }}</span>
                        <span class="ah-ltr lang__meta-end">01:24:07</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="ah-card">
            <div class="ah-card__body lang__rules">
                <strong>{{ $t('Language.rtl_flips_label') }}</strong> {{ $t('Language.rtl_flips') }}
                <strong>{{ $t('Language.rtl_keeps_label') }}</strong> {{ $t('Language.rtl_keeps') }}
            </div>
        </div>

        <div class="lang__actions">
            <button type="button" class="ah-btn ah-btn--primary" :disabled="saving" @click="save">
                {{ saving ? $t('Language.saving') : $t('Language.save') }}
            </button>
            <span v-if="savedAt" class="lang__saved">{{ $t('Language.saved') }}</span>
            <span v-if="error" class="ah-field__error">{{ error }}</span>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import * as env from "@/config/env";
import { apiRequestWithoutCompnay } from "@/services";
import { languageTranslateHelper } from "@/composable";
import {
    LOCALES,
    NUMERAL_SYSTEMS,
    DATE_FORMATS,
    NUMBER_FORMATS,
    WEEK_STARTS,
    localePrefs,
    savePrefs,
    formatDate,
    formatNumber
} from "./localePrefs";

defineOptions({ name: "LanguageRegion" });

const { t, locale, setLocaleMessage, messages } = useI18n({ useScope: "global" });
const { commit } = useStore();
const { changeLanguage } = languageTranslateHelper();
const userId = inject("$userId");

const currencies = ["USD", "EUR", "GBP", "INR", "JPY", "AUD", "CAD", "AED"];
const locales = LOCALES;
const numeralSystems = NUMERAL_SYSTEMS;
const dateFormats = DATE_FORMATS;
const numberFormats = NUMBER_FORMATS;
const weekStarts = WEEK_STARTS;

const form = reactive({ ...localePrefs });
const saving = ref(false);
const savedAt = ref(0);
const error = ref("");

const SAMPLE_DATE = new Date(2026, 8, 4);
const SAMPLE_MONEY = 1425.2;

const sampleDateLatin = computed(() => formatDate(SAMPLE_DATE, { ...form, numerals: "latn" }));
const sampleMoneyLatin = computed(() => `$${formatNumber(SAMPLE_MONEY, { ...form, numerals: "latn" })}`);
const sampleDateArab = computed(() => formatDate(SAMPLE_DATE, { ...form, numerals: "arab" }));
const sampleMoneyArab = computed(() => `${formatNumber(SAMPLE_MONEY, { ...form, numerals: "arab" })} $`);

const arabic = computed(() => messages.value?.ar?.LanguageV2 || {});
const rtlSampleTask = computed(() => arabic.value.sample_task || t("Language.sample_task_en"));
const rtlSampleStatus = computed(() => arabic.value.sample_status || t("Language.sample_status_en"));
const rtlSamplePriority = computed(() => arabic.value.sample_priority || t("Language.sample_priority_en"));

async function save() {
    saving.value = true;
    error.value = "";
    try {
        if (form.language !== localStorage.getItem("language")) {
            const bundle = await changeLanguage(form.language);
            if (!bundle) throw new Error(t("Language.error_language"));
            setLocaleMessage(form.language, bundle);
            localStorage.setItem("language", form.language);
            locale.value = form.language;
        }
        savePrefs({ ...form });

        const response = await apiRequestWithoutCompnay("put", env.USER_UPATE, {
            userId: userId?.value,
            updateObject: { $set: { languageCode: form.language, localePreferences: { ...form }, updatedAt: new Date() } },
            newObj: { returnDocument: "after" }
        });
        if (response?.data?.data) commit("users/mutateUsers", { data: response.data.data, op: "modified" });
        savedAt.value = Date.now();
    } catch (saveError) {
        error.value = saveError?.response?.data?.message || saveError?.message || t("Language.error_save");
    } finally {
        saving.value = false;
    }
}
</script>

<style scoped>
@import "./style.css";
</style>
