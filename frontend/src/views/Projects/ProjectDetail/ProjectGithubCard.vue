<template>
    <section v-if="view && view.enabled" ref="card" id="project-github" class="pgh" :aria-labelledby="ids.heading" data-project-github>
        <h5 :id="ids.heading" class="pgh__title">{{ $t('ProjectGithub.title') }}</h5>
        <p class="pgh__hint">{{ $t('ProjectGithub.hint') }}</p>
        <p v-if="notice" class="pgh__hint" role="status" data-notice>{{ notice }}</p>
        <p v-if="error" class="pgh__error" role="alert">{{ error }}</p>

        <GithubEgressNotice v-if="blockedHost" :host="blockedHost" @allowed="hostAllowed" />

        <template v-if="!connection">
            <button v-if="view.canManage && view.oneClick" type="button" class="ah-btn ah-btn--primary ah-btn--sm pgh__start" :disabled="busy" data-connect-github @click="connect">
                {{ $t('ProjectGithub.connect') }}
            </button>
            <router-link v-else-if="view.canManage" class="pgh__link" :to="{ name: 'AppConnections', params: { cid } }" data-set-up>{{ $t('ProjectGithub.set_up') }}</router-link>
            <p v-else class="pgh__hint" data-ask-admin>{{ $t('ProjectGithub.ask_admin') }}</p>
        </template>

        <template v-else>
            <p v-if="!connection.enabled" class="pgh__hint" data-paused>{{ $t('ProjectGithub.paused') }}</p>
            <p v-if="view.canManage && !connection.reachable" class="pgh__warn" data-unreachable>{{ $t('ProjectGithub.unreachable') }}</p>
            <ul v-if="view.repos.length" class="pgh__repos" data-repos>
                <li v-for="r in view.repos" :key="r.repo" class="pgh__repo">
                    <span class="pgh__name">{{ r.repo }}</span>
                    <button
                        v-if="view.canManage"
                        type="button"
                        class="ah-btn ah-btn--ghost ah-btn--sm"
                        :disabled="busy"
                        :aria-label="$t('ProjectGithub.remove_label', { repo: r.repo })"
                        data-remove-repo
                        @click="remove(r.repo)"
                    >{{ $t('ProjectGithub.remove') }}</button>
                    <span v-if="r.lastError && !r.blockedHost" class="pgh__error pgh__wide">{{ r.lastError }}</span>
                </li>
            </ul>
            <p v-else class="pgh__hint" data-no-repos>{{ $t('ProjectGithub.none') }}</p>
            <button v-if="view.canManage && !adding" type="button" class="ah-btn ah-btn--secondary ah-btn--sm pgh__start" :disabled="busy" data-add-repo @click="adding = true">
                {{ $t('ProjectGithub.add') }}
            </button>
            <GithubRepoPicker v-if="view.canManage && adding" :connection-id="connection.id" :saving="busy" @save="add" @cancel="adding = false" @blocked="onBlocked" />
        </template>
    </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import GithubEgressNotice from "@/views/Integrations/github/GithubEgressNotice.vue";
import GithubRepoPicker from "@/views/Integrations/github/GithubRepoPicker.vue";
import { EGRESS_BLOCKED, blockedHostIn } from "@/views/Integrations/github/githubEgress";
import { loadProjectGithub, projectGithubView } from "@/views/Integrations/github/projectGithub";
import { withoutGithubReturn } from "@/views/Integrations/githubReturn";

defineOptions({ name: "ProjectGithubCard" });

const props = defineProps({ projectId: { type: String, required: true } });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const uid = `pgh-${Math.random().toString(36).slice(2, 8)}`;
const ids = { heading: `${uid}-heading` };
const GITHUB_OUTCOMES = ["expired", "denied", "rights", "off", "failed"];
const GITHUB_REFUSALS = { 400: "github_expired", 403: "github_rights", 409: "github_off" };

const card = ref(null);
const busy = ref(false);
const adding = ref(false);
const error = ref("");
const notice = ref("");
const blocked = ref("");
const allowed = ref([]);

const view = computed(() => projectGithubView(props.projectId));
const connection = computed(() => view.value?.connection || null);
const cid = computed(() => route?.params?.cid || "");
const blockedHost = computed(() => {
    const host = blocked.value || (connection.value?.errorCode === EGRESS_BLOCKED ? connection.value.blockedHost : "");
    return host && !allowed.value.includes(host) ? host : "";
});

const githubFailure = (e) => t(`AppConnections.${GITHUB_REFUSALS[e?.response?.status] || "github_failed"}`);
const failure = (e) => e?.response?.data?.statusText || t("ProjectGithub.failed");

const onBlocked = (host) => {
    adding.value = false;
    allowed.value = allowed.value.filter((h) => h !== host);
    blocked.value = host;
};

const hostAllowed = (host) => {
    allowed.value = [...allowed.value, host];
    blocked.value = "";
    notice.value = t("AppConnections.egress_allowed", { host });
    if (view.value?.canManage && connection.value) adding.value = true;
};

const send = async (run, done) => {
    busy.value = true;
    error.value = "";
    notice.value = "";
    try {
        const res = await run();
        if (res?.data?.status === false) { error.value = res.data.statusText || t("ProjectGithub.failed"); return; }
        notice.value = done;
        await loadProjectGithub(props.projectId);
    } catch (e) {
        const host = blockedHostIn(e?.response?.data);
        if (host) onBlocked(host);
        else error.value = failure(e);
    } finally {
        busy.value = false;
    }
};

const add = async (repo) => {
    await send(() => apiRequest("post", `${env.INTEGRATIONS}/connections/${connection.value.id}/repos`, { repo, projectId: props.projectId }), t("ProjectGithub.added", { repo }));
    if (!error.value && !blocked.value) adding.value = false;
};

const remove = (repo) => send(
    () => apiRequest("delete", `${env.INTEGRATIONS}/connections/${connection.value.id}/repos/${props.projectId}?repo=${encodeURIComponent(repo)}`),
    t("ProjectGithub.removed", { repo }),
);

const connect = async () => {
    busy.value = true;
    error.value = "";
    try {
        const res = await apiRequest("get", `${env.INTEGRATIONS}/github/authorize?projectId=${props.projectId}`);
        if (res?.data?.status && res.data.data?.url) window.location.assign(res.data.data.url);
        else error.value = t("AppConnections.github_failed");
    } catch (e) {
        error.value = githubFailure(e);
    } finally {
        busy.value = false;
    }
};

/* The GitHub sign-in started here comes back to this tab with its code: it is taken out of the address before anything else. */
const finishGithub = async () => {
    const query = route?.query || {};
    const { github: outcome, state, code } = query;
    if (!outcome) return;
    await router.replace({ query: withoutGithubReturn(query) });
    if (outcome !== "complete") {
        if (GITHUB_OUTCOMES.includes(outcome)) error.value = t(`AppConnections.github_${outcome}`);
        return;
    }
    if (typeof state !== "string" || typeof code !== "string") return;
    busy.value = true;
    try {
        const res = await apiRequest("post", `${env.INTEGRATIONS}/github/complete`, { state, code });
        if (!res?.data?.status) { error.value = t("AppConnections.github_failed"); return; }
        notice.value = t("ProjectGithub.connected");
        const egress = res.data.data?.egressBlocked;
        await loadProjectGithub(props.projectId);
        if (egress?.host) onBlocked(egress.host);
        else if (connection.value) adding.value = true;
    } catch (e) {
        error.value = githubFailure(e);
    } finally {
        busy.value = false;
    }
};

const showIfAsked = async () => {
    if (route?.query?.section !== "github") return;
    await nextTick();
    card.value?.scrollIntoView?.({ block: "start", behavior: "smooth" });
};

watch(() => props.projectId, async (pid) => {
    if (!pid) return;
    adding.value = false;
    blocked.value = "";
    error.value = "";
    notice.value = "";
    await loadProjectGithub(pid);
    await finishGithub();
    await showIfAsked();
}, { immediate: true });

watch(() => route?.query?.section, showIfAsked);
</script>

<style scoped>
.pgh { display: flex; flex-direction: column; gap: 6px; margin: 20px 0 0; max-width: 520px; }
.pgh__title { margin: 0; font: 600 14px/1.3 var(--font-ui); color: var(--ink); }
.pgh__hint { margin: 0; color: var(--ink-2); font-size: 12px; }
.pgh__warn { margin: 0; padding: 8px 10px; border-radius: 6px; background: var(--warn-bg); color: var(--warn-ink); font-size: 12px; }
.pgh__error { margin: 0; color: var(--danger); font-size: 12px; }
.pgh__link { align-self: flex-start; color: var(--brand); font-size: 12.5px; }
.pgh__start { align-self: flex-start; }
.pgh__repos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.pgh__repo { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--hairline); }
.pgh__name { flex: 1; min-width: 0; font: 500 12.5px/1.3 var(--font-mono); color: var(--ink); overflow-wrap: anywhere; }
.pgh__wide { flex-basis: 100%; }
@media (max-width: 767px) {
    .pgh__start, .pgh__repo .ah-btn { min-height: 40px; }
}
</style>
