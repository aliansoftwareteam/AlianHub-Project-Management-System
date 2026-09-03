<template>
    <div class="auth" :class="{ 'auth--single': !proof }">
        <section class="auth__form">
            <header class="auth__top">
                <router-link to="/login" class="auth__brand">
                    <img v-if="logoOk" :src="logo" alt="" class="auth__logo" @error="logoOk = false" />
                    <span v-else class="auth__mark">{{ initial }}</span>
                    <span class="auth__name">{{ productName }}</span>
                </router-link>
                <div class="auth__top-right"><slot name="top-right" /></div>
            </header>
            <div class="auth__body">
                <slot />
            </div>
            <footer class="auth__foot">
                <div class="auth__foot-links">
                    <a v-if="brand.termsLink" :href="brand.termsLink" target="_blank" rel="noopener">{{ $t('Auth.tearm') }}</a>
                    <a v-if="brand.privacyLink" :href="brand.privacyLink" target="_blank" rel="noopener">{{ $t('Auth.Privacy_Policy') }}</a>
                    <a v-if="brand.helpLink" :href="brand.helpLink" target="_blank" rel="noopener">{{ $t('Shell.help') }}</a>
                </div>
                <slot name="foot-right" />
            </footer>
        </section>

        <aside v-if="proof" class="auth__proof" aria-hidden="true">
            <div class="auth__proof-label ah-mono">{{ $t('Auth.proof_label', { version }) }}</div>
            <h2 class="auth__proof-title">{{ $t('Auth.proof_title') }}</h2>
            <p class="auth__proof-sub">{{ $t('Auth.proof_sub') }}</p>
            <div class="auth__shot">
                <div class="auth__shot-rail">
                    <span class="auth__shot-mark"></span>
                    <span class="auth__shot-tile is-on"></span>
                    <span class="auth__shot-tile"></span>
                    <span class="auth__shot-tile"></span>
                    <span class="auth__shot-tile"></span>
                </div>
                <div class="auth__shot-main">
                    <div class="auth__shot-bar">
                        <strong>{{ $t('Home.today_overdue') }}</strong>
                        <span class="ah-mono">{{ today }}</span>
                    </div>
                    <div class="auth__shot-group"><span class="ah-label">{{ $t('Home.today') }} · 3</span></div>
                    <div class="auth__shot-row"><span class="auth__shot-box"></span><span>Redesign onboarding flow</span><em class="ah-mono">Website Revamp</em></div>
                    <div class="auth__shot-row"><span class="auth__shot-box"></span><span>Fix payment webhook retries</span><em class="ah-mono">Mobile v2</em></div>
                    <div class="auth__shot-group"><span class="ah-label auth__shot-over">{{ $t('Home.overdue') }} · 1</span></div>
                    <div class="auth__shot-row"><span class="auth__shot-box"></span><span>Review guest permission matrix</span><em class="ah-mono auth__shot-late">Aug 29</em></div>
                </div>
            </div>
        </aside>
    </div>
</template>

<script setup>
import { computed, defineProps, ref } from "vue";
import { useStore } from "vuex";
import moment from "moment";
import { version } from "../../../../../package.json";

defineProps({ proof: { type: Boolean, default: true } });

const { getters } = useStore();
const brand = computed(() => getters["brandSettingTab/brandSettings"] || {});
const productName = computed(() => brand.value.productName || "AlianHub");
const initial = computed(() => productName.value.charAt(0).toUpperCase());
const logo = "/api/v1/getlogo?key=favicon";
const logoOk = ref(true);
const today = moment().format("ddd MMM D").toUpperCase();
</script>

<style>
@import "./style.css";
</style>
