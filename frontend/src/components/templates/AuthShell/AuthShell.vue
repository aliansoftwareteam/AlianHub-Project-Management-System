<template>
    <div ref="rootRef" class="auth" :class="{ 'auth--single': !proof }">
        <section class="auth__form">
            <header class="auth__top" :role="standalone ? 'banner' : null">
                <router-link to="/login" class="auth__brand">
                    <img v-if="logoOk" :src="logo" alt="" class="auth__logo" @error="logoOk = false" />
                    <span v-else class="auth__mark">{{ initial }}</span>
                    <span class="auth__name">{{ productName }}</span>
                </router-link>
                <div class="auth__top-right"><slot name="top-right" /></div>
            </header>
            <div class="auth__body" :role="standalone ? 'main' : null">
                <slot />
            </div>
            <footer class="auth__foot" :role="standalone ? 'contentinfo' : null">
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
                    <div class="auth__shot-row"><span class="auth__shot-box"></span><span>{{ $t('Auth.proof_task_1') }}</span><em class="ah-mono">{{ $t('Auth.proof_project_1') }}</em></div>
                    <div class="auth__shot-row"><span class="auth__shot-box"></span><span>{{ $t('Auth.proof_task_2') }}</span><em class="ah-mono">{{ $t('Auth.proof_project_2') }}</em></div>
                    <div class="auth__shot-group"><span class="ah-label auth__shot-over">{{ $t('Home.overdue') }} · 1</span></div>
                    <div class="auth__shot-row"><span class="auth__shot-box"></span><span>{{ $t('Auth.proof_task_3') }}</span><em class="ah-mono auth__shot-late">{{ $t('Auth.proof_task_3_due') }}</em></div>
                </div>
            </div>
        </aside>
    </div>
</template>

<script setup>
import { computed, defineProps, onMounted, ref } from "vue";
import { useStore } from "vuex";
import moment from "moment";
import { useAppVersion } from "@/composable/useAppVersion";

defineProps({ proof: { type: Boolean, default: true } });

const { getters } = useStore();
const { version } = useAppVersion();
const brand = computed(() => getters["brandSettingTab/brandSettings"] || {});
const productName = computed(() => brand.value.productName || "AlianHub");
const initial = computed(() => productName.value.charAt(0).toUpperCase());
const logo = "/api/v1/getlogo?key=favicon";
const logoOk = ref(true);
const today = moment().format("ddd MMM D").toUpperCase();

/* The app shell already provides main; a second one inside it would be a nested landmark. */
const rootRef = ref(null);
const standalone = ref(false);
onMounted(() => { standalone.value = !rootRef.value?.parentElement?.closest("main, [role=main]"); });
</script>

<style>
@import "./style.css";
</style>
