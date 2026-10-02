<template>
    <div class="ah-page ai-page cya" :class="{ 'cya--welcome': welcome }" data-test="connect-ai">
        <AiSidebar v-if="!welcome" />
        <div class="ai-page__main">
            <div class="cya__body ah-scroll">
                <header class="cya__head">
                    <span v-if="welcome" class="ah-label">{{ $t('ConnectAi.welcome_kicker') }}</span>
                    <h1 class="ah-h2">{{ $t('ConnectAi.title') }}</h1>
                    <p class="cya__lead">{{ $t('ConnectAi.lead') }}</p>
                </header>

                <p class="cya__sign" :class="{ 'is-connected': connected }" role="status" aria-live="polite" data-test="connect-ai-sign">
                    <span v-if="connected" class="ah-dot ah-dot--ok" aria-hidden="true"></span>
                    <ShellIcon v-else name="clock" :size="14" class="cya__waiting" />
                    <span v-if="!known">{{ $t('ConnectAi.sign_checking') }}</span>
                    <span v-else>{{ connected ? $t('ConnectAi.sign_connected', { when: formatWhen(connection.lastSeenAt) }) : $t('ConnectAi.sign_waiting') }}</span>
                </p>

                <section v-if="connected" class="ah-card cya__first" data-test="connect-ai-first">
                    <div class="ah-card__body">
                        <span class="ah-label">{{ $t('ConnectAi.first_title') }}</span>
                        <div class="cya__copy-row">
                            <strong class="cya__sentence">{{ $t('ConnectAi.first_sentence') }}</strong>
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="copy('sentence', $t('ConnectAi.first_sentence'))">
                                {{ copied === 'sentence' ? $t('ConnectAi.copied') : $t('ConnectAi.copy') }}
                            </button>
                        </div>
                        <p class="cya__note">{{ $t('ConnectAi.first_note') }}</p>
                    </div>
                </section>

                <div v-if="known" class="cya__ways">
                    <section v-for="app in APPS" :key="app" class="ah-card" :data-test="`connect-ai-way-${app}`">
                        <div class="ah-card__body cya__way">
                            <h2 class="ah-h3">{{ $t(`ConnectAi.${app}_title`) }}</h2>
                            <template v-if="connection.apps">
                                <ol class="cya__steps">
                                    <li>{{ $t(`ConnectAi.${app}_open`) }}</li>
                                    <li>
                                        {{ $t('ConnectAi.paste_address') }}
                                        <div class="cya__copy-row">
                                            <code class="cya__address">{{ connection.address }}</code>
                                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="copy(app, connection.address)">
                                                {{ copied === app ? $t('ConnectAi.copied') : $t('ConnectAi.copy') }}
                                            </button>
                                        </div>
                                    </li>
                                    <li>{{ $t(`ConnectAi.${app}_allow`) }}</li>
                                </ol>
                                <p class="cya__note">{{ $t('ConnectAi.reach_note') }}</p>
                            </template>
                            <template v-else>
                                <p class="cya__note">{{ $t('ConnectAi.apps_off') }}</p>
                                <p class="cya__note">{{ $t('ConnectAi.setting_label') }} <code>{{ SETTING.apps }}</code></p>
                            </template>
                        </div>
                    </section>

                    <section class="ah-card" data-test="connect-ai-way-token">
                        <div class="ah-card__body cya__way">
                            <h2 class="ah-h3">{{ $t('ConnectAi.token_title') }}</h2>
                            <template v-if="connection.tokens">
                                <p class="cya__note">{{ $t('ConnectAi.token_body') }}</p>
                                <router-link class="ah-btn ah-btn--secondary ah-btn--sm cya__link" :to="tokenPage" data-test="connect-ai-token-link">{{ $t('ConnectAi.token_link') }}</router-link>
                            </template>
                            <p v-else class="cya__note">{{ $t('ConnectAi.tokens_off') }}</p>
                        </div>
                    </section>
                </div>

                <section v-if="known" class="ah-card" data-test="connect-ai-tools">
                    <div class="ah-card__body cya__way">
                        <h2 class="ah-h3">{{ $t('ConnectAi.tools_title') }}</h2>
                        <ul class="cya__list">
                            <li>{{ $t('ConnectAi.tools_base') }}</li>
                            <li v-for="key in toolsOn" :key="key">{{ $t(`ConnectAi.tools_${key}`) }}</li>
                        </ul>
                        <template v-if="toolsOff.length">
                            <span class="ah-label">{{ $t('ConnectAi.tools_off_title') }}</span>
                            <ul class="cya__list">
                                <li v-for="key in toolsOff" :key="key" data-test="connect-ai-tool-off">{{ $t(`ConnectAi.tools_${key}`) }} <code>{{ SETTING[key] }}</code></li>
                            </ul>
                            <p class="cya__note" data-test="connect-ai-tools-admin">{{ $t('ConnectAi.tools_admin') }}</p>
                        </template>
                    </div>
                </section>

                <p class="cya__note" data-test="connect-ai-limit">{{ $t('ConnectAi.limit') }}</p>

                <p v-if="mayAddServerKey" class="cya__note" data-test="connect-ai-server-key">
                    {{ $t('ConnectAi.server_key_optional') }}
                    <router-link class="cya__inline-link" :to="serverKeyPage">{{ $t('ConnectAi.server_key_link') }}</router-link>
                </p>

                <footer v-if="welcome" class="cya__foot">
                    <button v-if="connected" type="button" class="ah-btn ah-btn--primary" data-test="connect-ai-continue" @click="goHome">{{ $t('ConnectAi.go_home') }}</button>
                    <template v-else>
                        <button type="button" class="ah-btn ah-btn--secondary" data-test="connect-ai-skip" @click="skip">{{ $t('ConnectAi.skip') }}</button>
                        <span class="cya__note">{{ $t('ConnectAi.skip_note') }}</span>
                    </template>
                </footer>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, unref } from "vue";
import { useRoute, useRouter } from "vue-router";
import AiSidebar from "./AiSidebar.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { AI_STATE, aiAvailability } from "@/composable/aiAvailability";
import { aiConnection as connection, aiConnectionKnownFor, watchAiConnection } from "@/composable/aiConnection";
import { saveOnboarding } from "@/composable/onboardingState";
import { formatWhen } from "@/views/OAuth/oauthShared";

defineOptions({ name: "ConnectYourAi" });

const APPS = ["claude", "chatgpt"];
const TOOL_KEYS = ["data", "manage", "work"];
const SETTING = Object.freeze({ apps: "MCP_OAUTH", data: "MCP_TOOLS_DATA", manage: "MCP_TOOLS_MANAGE", work: "MCP_TOOLS_WORK" });
const COPIED_MS = 1600;

const route = useRoute();
const router = useRouter();
const companyId = inject("$companyId", "");

const welcome = computed(() => route.meta?.welcome === true);
const known = computed(() => aiConnectionKnownFor(unref(companyId)));
const connected = computed(() => known.value && connection.connected === true);
const toolsOn = computed(() => TOOL_KEYS.filter((key) => connection.tools?.[key]));
const toolsOff = computed(() => TOOL_KEYS.filter((key) => !connection.tools?.[key]));
const mayAddServerKey = computed(() => aiAvailability.state === AI_STATE.UNCONFIGURED && aiAvailability.canConfigureInstance === true);

const inWorkspace = (name, query) => ({ name, params: { cid: unref(companyId) }, ...(query ? { query } : {}) });
const tokenPage = computed(() => inWorkspace("AiAccounts", { tab: "link" }));
const serverKeyPage = computed(() => inWorkspace("InstanceSettings", { group: "ai" }));

const copied = ref("");
const copy = async (key, text) => {
    try {
        await navigator.clipboard.writeText(text);
        copied.value = key;
        setTimeout(() => { if (copied.value === key) copied.value = ""; }, COPIED_MS);
    } catch (error) {
        copied.value = "";
    }
};

const goHome = () => router.replace(inWorkspace("Home")).catch(() => {});
const skip = () => {
    saveOnboarding({ connectAiSkipped: true });
    goHome();
};

let stopWatching = () => {};
onMounted(() => { stopWatching = watchAiConnection(() => unref(companyId)); });
onBeforeUnmount(() => stopWatching());
</script>

<style>
@import "./style.css";
</style>

<style scoped>
.cya__body { flex: 1; min-height: 0; overflow: auto; padding: 20px 24px 32px; display: flex; flex-direction: column; gap: 16px; max-width: 960px; width: 100%; box-sizing: border-box; }
.cya--welcome .cya__body { margin: 0 auto; padding-top: 40px; }
.cya__head { display: flex; flex-direction: column; gap: 6px; }
.cya__lead { margin: 0; font: var(--text-body); color: var(--ink-2); max-width: 720px; }
.cya__sign { display: flex; align-items: center; gap: 8px; margin: 0; padding: 10px 14px; border-radius: var(--r-card); border: 1px solid var(--border); background: var(--surface); font: var(--text-body); color: var(--ink); }
.cya__waiting { flex: none; color: var(--ink-2); }
.cya__sign.is-connected { background: var(--ok-bg); border-color: transparent; color: var(--ok-ink); }
.cya__ways { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 16px; align-items: start; }
.cya__way { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.cya__way .ah-h3 { margin: 0; }
.cya__steps, .cya__list { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; font: var(--text-body); color: var(--ink); }
.cya__copy-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; }
.cya__address { padding: 4px 8px; border-radius: 6px; background: var(--surface-2); color: var(--ink); font-family: var(--font-mono); font-size: 12px; overflow-wrap: anywhere; min-width: 0; }
.cya__sentence { font: var(--text-h2); color: var(--ink); overflow-wrap: anywhere; }
.cya__note { margin: 0; font: var(--text-small); color: var(--ink-2); }
.cya__note code, .cya__list code { padding: 1px 5px; border-radius: 4px; background: var(--surface-hover); color: var(--ink); overflow-wrap: anywhere; }
.cya__link { align-self: flex-start; }
.cya__inline-link { color: var(--ink); text-decoration: underline; }
.cya__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding-top: 8px; border-top: 1px solid var(--hairline); }
@media (max-width: 640px) {
    .cya__body { padding: 16px 16px 24px; }
    .cya__foot .ah-btn { min-height: 44px; }
}
</style>
