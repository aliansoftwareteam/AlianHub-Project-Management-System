<template>
    <div class="ah-page acct-page">
        <AiSidebar />

        <div class="acct-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('Accounts.title') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <span v-if="mode" class="ah-chip ah-chip--brand ah-chip--mono">{{ $t(`Accounts.mode_${mode}`) }}</span>
                <span v-else class="ah-chip ah-chip--mono">{{ $t('Accounts.not_linked') }}</span>
            </div>

            <div class="acct-page__body ah-scroll">
                <div class="ah-tabs">
                    <button v-for="tabKey in tabs" :key="tabKey" type="button" class="ah-tab" :class="{ 'is-active': tab === tabKey }" @click="tab = tabKey">
                        {{ $t(`Accounts.tab_${tabKey}`) }}
                    </button>
                </div>

                <!-- 27a — three modes side by side -->
                <template v-if="tab === 'modes'">
                    <p class="acct-lead">{{ $t('Accounts.modes_lead') }}</p>

                    <section class="ah-card">
                        <div class="ah-card__body">
                            <div class="acct-matrix">
                                <div></div>
                                <div v-for="m in MODES" :key="m" class="acct-mode" :class="{ 'is-mine': m === mode, 'is-refused': !isAllowed(m) }">
                                    <div class="acct-mode__name">{{ $t(`Accounts.mode_${m}`) }}</div>
                                    <div class="acct-mode__sub">{{ $t(`Accounts.mode_${m}_sub`) }}</div>
                                    <div class="acct-mode__flags">
                                        <span v-if="m === mode" class="ah-chip ah-chip--brand ah-chip--mono">{{ $t('Accounts.yours') }}</span>
                                        <span v-if="!isAllowed(m)" class="ah-chip ah-chip--mono">{{ $t('Accounts.not_permitted') }}</span>
                                    </div>
                                </div>
                            </div>

                            <div v-for="row in matrixRows" :key="row" class="acct-matrix">
                                <div class="acct-matrix__label">{{ $t(`Accounts.row_${row}`) }}</div>
                                <div v-for="m in MODES" :key="m" class="acct-matrix__cell">{{ $t(`Accounts.row_${row}_${m}`) }}</div>
                            </div>
                        </div>
                    </section>

                    <section class="ah-card">
                        <div class="ah-card__head">
                            <span class="ah-h3">{{ $t('Accounts.policy_title') }}</span>
                            <span class="ah-mono acct-note">{{ privileged ? $t('Accounts.policy_you_can_edit') : $t('Accounts.policy_read_only') }}</span>
                        </div>
                        <div class="ah-card__body">
                            <div class="acct-policy">
                                <label v-for="m in MODES" :key="m" class="acct-policy__row">
                                    <input class="ah-check" type="checkbox" :checked="draftModes.includes(m)" :disabled="!privileged || savingPolicy" @change="toggleMode(m)" />
                                    <span>
                                        {{ $t(`Accounts.mode_${m}`) }}
                                        <small>{{ $t(`Accounts.policy_${m}_effect`) }}</small>
                                    </span>
                                </label>

                                <p v-if="policyError" class="ah-field__error">{{ policyError }}</p>

                                <div v-if="privileged" class="acct-policy__actions">
                                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="savingPolicy || !policyDirty" @click="onSavePolicy">
                                        {{ $t('Accounts.save_policy') }}
                                    </button>
                                    <span v-if="policySaved" class="acct-note">{{ $t('Accounts.policy_saved') }}</span>
                                </div>
                                <p class="acct-note">{{ $t('Accounts.policy_refusal_note') }}</p>
                            </div>
                        </div>
                    </section>

                    <div class="acct-callout acct-callout--ok">
                        <strong>{{ $t('Accounts.recommended_label') }}</strong> {{ $t('Accounts.recommended_body') }}
                    </div>
                </template>

                <!-- 27b — linking, and 26a — the setup panel -->
                <template v-else-if="tab === 'link'">
                    <p class="acct-lead">{{ $t('Accounts.link_lead') }}</p>

                    <div class="acct-cols">
                        <div class="acct-stack">
                            <section class="ah-card">
                                <div class="ah-card__head">
                                    <span class="ah-h3">{{ $t('Accounts.my_account') }}</span>
                                </div>
                                <div class="ah-card__body">
                                    <template v-if="account">
                                        <div class="acct-linked">
                                            <span class="acct-linked__logo"><ShellIcon name="agent" :size="16" /></span>
                                            <span class="acct-linked__text">
                                                <span class="acct-linked__name">{{ providerLabel(account.provider) }}</span>
                                                <span class="acct-linked__meta">{{ accountMeta }}</span>
                                            </span>
                                            <span class="acct-linked__state"><span class="ah-dot ah-dot--ok"></span>{{ $t('Accounts.active') }}</span>
                                        </div>

                                        <div class="acct-boundary" style="margin-top:12px">
                                            <div class="acct-boundary__half acct-boundary__half--sees">
                                                <div class="acct-boundary__title">{{ $t('Accounts.sees_title') }}</div>
                                                <ul class="acct-boundary__list">
                                                    <li v-for="i in 5" :key="i">{{ $t(`Accounts.sees_${i}`) }}</li>
                                                </ul>
                                            </div>
                                            <div class="acct-boundary__half acct-boundary__half--yours">
                                                <div class="acct-boundary__title">{{ $t('Accounts.yours_title') }}</div>
                                                <ul class="acct-boundary__list">
                                                    <li v-for="i in 4" :key="i">{{ $t(`Accounts.stays_${i}`) }}</li>
                                                </ul>
                                            </div>
                                        </div>
                                        <p class="acct-note" style="margin-top:8px">{{ $t('Accounts.boundary_source') }}</p>

                                        <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
                                            <div v-for="i in 3" :key="i" class="acct-fact">
                                                <span class="acct-fact__tick"><ShellIcon name="check" :size="9" /></span>
                                                <span>{{ $t(`Accounts.always_${i}`) }}<span class="acct-where">{{ $t(`Accounts.always_${i}_where`) }}</span></span>
                                            </div>
                                        </div>

                                        <button
                                            v-if="mode !== 'workspace' && isAllowed('workspace')"
                                            type="button"
                                            class="ah-btn ah-btn--secondary ah-btn--sm"
                                            style="margin-top:12px"
                                            :disabled="linking"
                                            @click="onSwitchToWorkspace"
                                        >
                                            {{ $t('Accounts.switch_workspace') }}
                                        </button>

                                        <div class="acct-danger" style="margin-top:14px">
                                            <div style="flex:1">
                                                <strong>{{ $t('Accounts.unlink') }}</strong> {{ $t('Accounts.unlink_body') }}
                                            </div>
                                            <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="unlinking" @click="onUnlink">
                                                {{ $t('Accounts.unlink') }}
                                            </button>
                                        </div>
                                        <p v-if="linkError" class="ah-field__error">{{ linkError }}</p>
                                    </template>

                                    <template v-else>
                                        <p class="acct-lead">{{ $t('Accounts.link_form_lead') }}</p>

                                        <div class="ah-field" style="margin-top:10px">
                                            <label class="ah-field__label" for="acct-mode">{{ $t('Accounts.field_mode') }}</label>
                                            <select id="acct-mode" v-model="form.mode" class="ah-input">
                                                <option v-for="m in allowed" :key="m" :value="m">{{ $t(`Accounts.mode_${m}`) }}</option>
                                            </select>
                                        </div>

                                        <div class="ah-field">
                                            <label class="ah-field__label" for="acct-provider">{{ $t('Accounts.field_provider') }}</label>
                                            <select id="acct-provider" v-model="form.provider" class="ah-input">
                                                <option v-for="p in PROVIDERS" :key="p" :value="p">{{ providerLabel(p) }}</option>
                                            </select>
                                        </div>

                                        <div class="ah-field">
                                            <label class="ah-field__label" for="acct-label">{{ $t('Accounts.field_label') }}</label>
                                            <input id="acct-label" v-model="form.label" class="ah-input" type="text" :placeholder="$t('Accounts.field_label_hint')" />
                                        </div>

                                        <div class="ah-field">
                                            <label class="ah-field__label" for="acct-email">{{ $t('Accounts.field_email') }}</label>
                                            <input id="acct-email" v-model="form.email" class="ah-input" :class="{ 'ah-input--error': Boolean(linkError) }" type="email" :placeholder="$t('Accounts.field_email_hint')" />
                                            <p v-if="linkError" class="ah-field__error">{{ linkError }}</p>
                                        </div>

                                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="linking || !allowed.length" @click="onLink">
                                            {{ $t('Accounts.link_account') }}
                                        </button>
                                        <p v-if="!allowed.length" class="acct-note" style="margin-top:8px">{{ $t('Accounts.no_modes_allowed') }}</p>
                                    </template>
                                </div>
                            </section>

                            <section class="ah-card">
                                <div class="ah-card__head">
                                    <span class="ah-h3">{{ $t('Accounts.summary_title') }}</span>
                                    <span class="ah-mono acct-note">{{ summary.month || '' }}</span>
                                </div>
                                <div class="ah-card__body">
                                    <div class="acct-stats">
                                        <div>
                                            <div class="acct-stats__n">{{ summary.tasksWorked || 0 }}</div>
                                            <div class="acct-stats__k">{{ $t('Accounts.stat_tasks') }}</div>
                                        </div>
                                        <div>
                                            <div class="acct-stats__n">{{ summary.agentHours || 0 }}h</div>
                                            <div class="acct-stats__k">{{ $t('Accounts.stat_hours') }}</div>
                                        </div>
                                        <div>
                                            <div class="acct-stats__n">{{ summary.prsOpened || 0 }}</div>
                                            <div class="acct-stats__k">{{ $t('Accounts.stat_prs') }}</div>
                                        </div>
                                        <div>
                                            <div class="acct-stats__n acct-stats__n--ok">${{ summary.usdToCompany || 0 }}</div>
                                            <div class="acct-stats__k">{{ $t('Accounts.stat_company') }}</div>
                                        </div>
                                    </div>
                                    <p class="acct-note" style="margin-top:10px">{{ $t('Accounts.summary_note') }}</p>
                                </div>
                            </section>
                        </div>

                        <div class="acct-stack">
                            <section class="ah-card">
                                <div class="ah-card__head">
                                    <span class="ah-h3">{{ $t('Accounts.cli_title') }}</span>
                                    <span class="ah-mono acct-note">{{ $t('Accounts.cli_breadcrumb') }}</span>
                                </div>
                                <div class="ah-card__body">
                                    <div class="acct-cli">
                                        <button type="button" class="ah-btn ah-btn--dark ah-btn--sm acct-cli__copy" @click="copy(setupCommand, 'cli')">
                                            {{ copied === 'cli' ? $t('Accounts.copied') : $t('Accounts.copy') }}
                                        </button>
                                        <div v-for="(line, i) in cliLines" :key="i" class="acct-cli__line" :class="`acct-cli__line--${line.kind}`">
                                            <span v-if="line.kind === 'cmd'" class="acct-cli__prompt">$ </span>{{ line.text }}
                                        </div>
                                    </div>
                                    <p class="acct-note" style="margin-top:8px">{{ minted ? $t('Accounts.cli_url_minted') : $t('Accounts.cli_url_guess') }}</p>
                                </div>
                            </section>

                            <section class="ah-card">
                                <div class="ah-card__head">
                                    <span class="ah-h3">{{ $t('Accounts.tokens_title') }}</span>
                                    <button v-if="!minting" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="minting = true">{{ $t('Accounts.new_token') }}</button>
                                </div>
                                <div class="ah-card__body">
                                    <div v-if="minted" class="acct-secret">
                                        <div class="acct-secret__once">{{ $t('Accounts.token_once') }}</div>
                                        <div class="acct-secret__value">{{ minted.token }}</div>
                                        <div style="display:flex;gap:6px;flex-wrap:wrap">
                                            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="copy(minted.token, 'token')">
                                                {{ copied === 'token' ? $t('Accounts.copied') : $t('Accounts.copy_token') }}
                                            </button>
                                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="copy(setupCommand, 'cli')">
                                                {{ copied === 'cli' ? $t('Accounts.copied') : $t('Accounts.copy_command') }}
                                            </button>
                                            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="minted = null">{{ $t('Accounts.hide_token') }}</button>
                                        </div>
                                    </div>

                                    <template v-if="minting">
                                        <div class="ah-field" style="margin-top:10px">
                                            <label class="ah-field__label" for="tok-name">{{ $t('Accounts.field_token_name') }}</label>
                                            <input id="tok-name" v-model="tokenForm.name" class="ah-input" :class="{ 'ah-input--error': Boolean(mintError) }" type="text" :placeholder="$t('Accounts.field_token_name_hint')" />
                                            <p v-if="mintError" class="ah-field__error">{{ mintError }}</p>
                                        </div>
                                        <div class="ah-field">
                                            <label class="ah-field__label" for="tok-mode">{{ $t('Accounts.field_mode') }}</label>
                                            <select id="tok-mode" v-model="tokenForm.mode" class="ah-input">
                                                <option v-for="m in allowed" :key="m" :value="m">{{ $t(`Accounts.mode_${m}`) }}</option>
                                            </select>
                                        </div>
                                        <div class="ah-field">
                                            <label class="ah-field__label" for="tok-provider">{{ $t('Accounts.field_provider') }}</label>
                                            <select id="tok-provider" v-model="tokenForm.provider" class="ah-input">
                                                <option v-for="p in PROVIDERS" :key="p" :value="p">{{ providerLabel(p) }}</option>
                                            </select>
                                        </div>
                                        <div class="ah-field">
                                            <label class="ah-field__label" for="tok-project">{{ $t('Accounts.field_scope') }}</label>
                                            <select id="tok-project" v-model="tokenForm.projectId" class="ah-input">
                                                <option value="">{{ $t('Accounts.scope_all') }}</option>
                                                <option v-for="p in projects" :key="p._id" :value="p._id">{{ p.ProjectName }}</option>
                                            </select>
                                            <p class="acct-note">{{ $t('Accounts.scope_hint') }}</p>
                                        </div>
                                        <div style="display:flex;gap:6px">
                                            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="mintBusy" @click="onMint">{{ $t('Accounts.create_token') }}</button>
                                            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="minting = false">{{ $t('Accounts.cancel') }}</button>
                                        </div>
                                    </template>

                                    <div style="margin-top:12px">
                                        <div v-for="tk in tokens" :key="tk._id" class="acct-token" :class="{ 'is-revoked': !tk.active }">
                                            <div class="acct-token__text">
                                                <div class="acct-token__name">{{ tk.name }}</div>
                                                <div class="acct-token__meta">{{ tokenMeta(tk) }}</div>
                                            </div>
                                            <button v-if="tk.active" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="revoking === tk._id" @click="onRevoke(tk)">
                                                {{ $t('Accounts.revoke') }}
                                            </button>
                                            <span v-else class="ah-chip ah-chip--mono">{{ $t('Accounts.revoked') }}</span>
                                        </div>
                                        <p v-if="!tokens.length" class="ah-empty">{{ $t('Accounts.no_tokens') }}</p>
                                    </div>

                                    <div v-if="manifest.tools.length" style="margin-top:12px">
                                        <div class="ah-label">{{ $t('Accounts.allow_list') }}</div>
                                        <div class="acct-chips" style="margin-top:6px">
                                            <span v-for="tool in manifest.tools" :key="tool.name" class="ah-chip ah-chip--ok ah-chip--mono">{{ tool.name }}</span>
                                        </div>
                                    </div>
                                    <p class="acct-note" style="margin-top:10px">{{ $t('Accounts.token_inherits') }}</p>
                                </div>
                            </section>

                            <div class="acct-callout acct-callout--brand">{{ $t('Accounts.self_hosted_note') }}</div>
                        </div>
                    </div>
                </template>

                <!-- 27c — attribution -->
                <template v-else-if="tab === 'attribution'">
                    <p class="acct-lead">{{ $t('Accounts.attrib_lead') }}</p>

                    <section class="ah-card">
                        <div class="ah-card__head">
                            <span class="ah-h3">{{ $t('Accounts.attrib_title') }}</span>
                            <span class="ah-mono acct-note">{{ $t('Accounts.attrib_count', { n: attributionRows.length }) }}</span>
                        </div>
                        <div class="ah-card__body">
                            <div v-for="row in attributionRows" :key="row.key" class="acct-attrib-row">
                                <AccountAttribution :attribution="row.attribution" :sub="row.sub" />
                            </div>
                            <p v-if="!attributionRows.length" class="ah-empty">{{ $t('Accounts.attrib_empty') }}</p>
                        </div>
                    </section>

                    <section v-if="sourceTotal > 0" class="ah-card">
                        <div class="ah-card__head">
                            <span class="ah-h3">{{ $t('Category.by_source_title') }}</span>
                            <span class="ah-mono acct-note">{{ $t('Category.by_source_total', { n: sourceTotal.toFixed(1) }) }}</span>
                        </div>
                        <div class="ah-card__body">
                            <div class="acct-bar">
                                <div v-for="seg in sourceSplit" :key="seg.via" class="acct-bar__seg" :class="`acct-bar__seg--${seg.via}`" :style="{ width: `${seg.pct}%` }"></div>
                            </div>
                            <div class="acct-legend" style="margin-top:10px">
                                <span v-for="seg in sourceSplit" :key="seg.via">
                                    <span class="acct-legend__key" :class="`acct-bar__seg--${seg.via}`"></span>
                                    {{ segmentLabel(seg.via) }} {{ seg.hours.toFixed(1) }}h
                                </span>
                            </div>
                            <div class="acct-callout acct-callout--quiet" style="margin-top:10px">
                                <strong>{{ $t('Accounts.why_split_label') }}</strong> {{ $t('Accounts.why_split_body') }}
                            </div>
                            <p class="acct-note" style="margin-top:8px">{{ $t('Category.by_source_source') }}</p>
                        </div>
                    </section>

                    <div class="acct-callout acct-callout--quiet">
                        <strong>{{ $t('Accounts.billing_q_label') }}</strong> {{ $t('Accounts.billing_q_body') }}
                    </div>
                </template>

                <!-- 27d — the awkward cases, decided in advance -->
                <template v-else>
                    <p class="acct-lead">{{ $t('Accounts.rules_lead') }}</p>

                    <section class="ah-card">
                        <div class="ah-card__body">
                            <div class="acct-rules">
                                <div v-for="col in ruleColumns" :key="col.key" class="acct-rules__col">
                                    <div class="acct-rules__head">{{ $t(`Accounts.rules_${col.key}`) }}</div>
                                    <div v-for="item in col.items" :key="item" class="acct-rule">
                                        <strong>{{ $t(`Accounts.rule_${item}`) }}</strong> {{ $t(`Accounts.rule_${item}_body`) }}
                                        <span class="acct-where">{{ $t(`Accounts.rule_${item}_where`) }}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section v-if="manifest.never.length" class="ah-card">
                        <div class="ah-card__head">
                            <span class="ah-h3">{{ $t('Accounts.never_title') }}</span>
                            <span class="ah-mono acct-note">{{ $t('Accounts.never_source') }}</span>
                        </div>
                        <div class="ah-card__body">
                            <div class="acct-chips">
                                <span v-for="n in manifest.never" :key="n" class="ah-chip ah-chip--danger ah-chip--mono">{{ n }}</span>
                            </div>
                            <p class="acct-note" style="margin-top:10px">{{ $t('Accounts.never_body') }}</p>
                        </div>
                    </section>

                    <section class="ah-card">
                        <div class="ah-card__head">
                            <span class="ah-h3">{{ $t('Accounts.undecided_title') }}</span>
                        </div>
                        <div class="ah-card__body">
                            <div v-for="i in 2" :key="i" class="acct-rule" style="margin-bottom:10px">
                                <strong>{{ $t(`Accounts.undecided_${i}`) }}</strong> {{ $t(`Accounts.undecided_${i}_body`) }}
                            </div>
                        </div>
                    </section>

                    <div class="acct-callout acct-callout--quiet">{{ $t('Accounts.why_shape_body') }}</div>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useGetterFunctions } from "@/composable/index.js";
import AiSidebar from "./AiSidebar.vue";
import AccountAttribution from "./AccountAttribution.vue";
import { useAccounts, MODES, PROVIDERS } from "./useAccounts";

// Coding-agent accounts (27a-d) and the CLI setup panel (26a). Every claim on
// this page is one the backend actually makes: the modes and the policy come
// from /agents/policy, the tool and never lists from the live /mcp/manifest,
// and the boundary statements from what the code stores.
defineOptions({ name: "AiAccounts" });

const { t } = useI18n();
const { getters } = useStore();
const { getUser } = useGetterFunctions();
const companyId = inject("$companyId");

const {
    account, policy, summary, tokens, manifest, runs, peopleHours,
    mode, allowed, isAllowed,
    loadAccount, loadTokens, loadManifest, loadRuns, loadPeopleHours,
    savePolicy, linkAccount, unlinkAccount, mintToken, revokeToken
} = useAccounts();

const tabs = ["modes", "link", "attribution", "rules"];
const matrixRows = ["pays", "where", "can", "offboarding", "best"];
const ruleColumns = [
    { key: "people", items: ["leaves", "lapses", "contractor", "two_people"] },
    { key: "policy", items: ["require_mode", "unattended", "allow_list", "reimbursement"] },
    { key: "money", items: ["personal_spend", "revoke", "caps", "local_spend"] }
];

const tab = ref("modes");
const draftModes = ref([...MODES]);
const savingPolicy = ref(false);
const policySaved = ref(false);
const policyError = ref("");
const linking = ref(false);
const unlinking = ref(false);
const linkError = ref("");
const minting = ref(false);
const mintBusy = ref(false);
const mintError = ref("");
const minted = ref(null);
const revoking = ref("");
const copied = ref("");

const form = reactive({ mode: "personal", provider: "claude-code", label: "", email: "" });
const tokenForm = reactive({ name: "", mode: "personal", provider: "claude-code", projectId: "" });

const companyUser = computed(() => getters["settings/companyUserDetail"] || {});
const privileged = computed(() => [1, 2].includes(companyUser.value.roleType));
const projects = computed(() => (getters["projectData/projects"]?.data || []).filter((p) => !p.deletedStatusKey));

const policyDirty = computed(() => draftModes.value.slice().sort().join() !== (policy.value.allowedModes || []).slice().sort().join());

const providerLabel = (key) => (PROVIDERS.includes(key) ? t(`Accounts.provider_${String(key).replace("-", "_")}`) : t("Accounts.provider_other"));

const accountMeta = computed(() => {
    const a = account.value || {};
    const parts = [a.email || a.label, a.linkedAt ? t("Accounts.linked_on", { d: new Date(a.linkedAt).toLocaleDateString() }) : ""];
    return parts.filter(Boolean).join(" · ");
});

const mcpUrl = computed(() => (minted.value && minted.value.mcpUrl) || `${window.location.origin}/mcp?companyId=${companyId.value || ""}`);
const tokenForCommand = computed(() => (minted.value ? minted.value.token : "ah_pat_••••••••"));
const setupCommand = computed(() => `claude mcp add --transport http alianhub "${mcpUrl.value}" --header "Authorization: Bearer ${tokenForCommand.value}"`);

const cliLines = computed(() => {
    const lines = [
        { kind: "comment", text: `# ${t("Accounts.cli_comment_add")}` },
        { kind: "cmd", text: "claude mcp add --transport http alianhub \\" },
        { kind: "indent", text: `"${mcpUrl.value}" \\` },
        { kind: "indent", text: `--header "Authorization: Bearer ${tokenForCommand.value}"` }
    ];
    if (manifest.value.tools.length) {
        lines.push({ kind: "ok", text: t("Accounts.cli_connected", { n: manifest.value.tools.length, v: manifest.value.protocolVersion }) });
    }
    lines.push({ kind: "blank", text: "" });
    lines.push({ kind: "comment", text: `# ${t("Accounts.cli_comment_others")}` });
    lines.push({ kind: "cmd", text: `antigravity mcp add alianhub --url ${mcpUrl.value}` });
    lines.push({ kind: "cmd", text: `cursor mcp add alianhub --url ${mcpUrl.value}` });
    lines.push({ kind: "cmd", text: `codex config mcp.alianhub.url=${mcpUrl.value}` });
    return lines;
});

const tokenMeta = (tk) => [
    tk.prefix ? `${tk.prefix}…` : "",
    tk.createdAt ? t("Accounts.created_on", { d: new Date(tk.createdAt).toLocaleDateString() }) : "",
    tk.lastUsedAt ? t("Accounts.used_on", { d: new Date(tk.lastUsedAt).toLocaleString() }) : t("Accounts.never_used"),
    tk.agentAccount && tk.agentAccount.mode ? t(`Accounts.mode_${tk.agentAccount.mode}`) : "",
    tk.projectIds && tk.projectIds.length ? t("Accounts.scoped_projects", { n: tk.projectIds.length }) : ""
].filter(Boolean).join(" · ");

const personNameOf = (id) => (id ? (getUser(String(id)) || {}).Employee_Name || "" : "");

/* Attribution rows come from real runs; the shape is exactly what
 * Modules/Agents/actor.js attribution() plus the audit meta carries. */
const attributionRows = computed(() => (runs.value || []).slice(0, 8).map((run) => ({
    key: String(run._id),
    attribution: {
        actorType: "agent",
        agentId: run.agentId ? String(run.agentId) : null,
        agentName: run.agentName || "",
        viaAccount: run.viaAccount || "workspace",
        onBehalfOf: run.startedBy ? String(run.startedBy) : null,
        personName: personNameOf(run.startedBy)
    },
    sub: [
        t(`Accounts.mode_${run.viaAccount || "workspace"}`),
        run.skill || "",
        run.elapsedMs ? t("Accounts.elapsed", { n: Math.max(1, Math.round(Number(run.elapsedMs) / 60000)) }) : "",
        run.spend && run.spend.billedToWorkspace ? `$${Number(run.spend.usd || 0).toFixed(2)}` : "$0"
    ].filter(Boolean).join(" · ")
})));

/* People are one bucket. `viaAccount` names the AI account a model run was
 * billed to — Modules/Agents/actor.js hard-sets a human actor to "workspace"
 * for that reason — so there is nothing on a time log to split people by, and
 * a split drawn anyway would be a number nothing in the product recorded. */
const sourceSplit = computed(() => {
    const byVia = { workspace: 0, personal: 0, local: 0 };
    (runs.value || []).forEach((run) => {
        const via = MODES.includes(run.viaAccount) ? run.viaAccount : "workspace";
        byVia[via] += Number(run.elapsedMs || 0) / 3600000;
    });
    const rows = [
        { via: "people", hours: Number(peopleHours.value) || 0 },
        ...MODES.map((m) => ({ via: m, hours: byVia[m] }))
    ].filter((row) => row.hours > 0);
    const total = rows.reduce((sum, row) => sum + row.hours, 0);
    if (!total) return [];
    return rows.map((row) => ({ ...row, pct: (row.hours / total) * 100 }));
});

const sourceTotal = computed(() => sourceSplit.value.reduce((sum, s) => sum + s.hours, 0));

const segmentLabel = (via) => (via === "people" ? t("Category.source_people") : t(`Accounts.mode_${via}`));

/* The people total covers exactly the window the charted runs cover, so the
 * two halves of the bar are always the same stretch of time. */
const runWindow = computed(() => {
    const stamps = (runs.value || [])
        .map((run) => (run.startedAt ? new Date(run.startedAt).getTime() : NaN))
        .filter((ms) => Number.isFinite(ms));
    if (!stamps.length) return null;
    return { start: Math.min(...stamps) / 1000, end: Date.now() / 1000 };
});

const toggleMode = (m) => {
    policySaved.value = false;
    policyError.value = "";
    draftModes.value = draftModes.value.includes(m) ? draftModes.value.filter((x) => x !== m) : [...draftModes.value, m];
};

const onSavePolicy = async () => {
    policyError.value = "";
    if (!draftModes.value.length) {
        policyError.value = t("Accounts.policy_need_one");
        return;
    }
    savingPolicy.value = true;
    try {
        await savePolicy(draftModes.value);
        policySaved.value = true;
    } catch (error) {
        policyError.value = error.message;
    } finally {
        savingPolicy.value = false;
    }
};

const onLink = async () => {
    linkError.value = "";
    linking.value = true;
    try {
        await linkAccount({ mode: form.mode, provider: form.provider, label: form.label, email: form.email });
        await loadAccount();
    } catch (error) {
        linkError.value = error.message;
    } finally {
        linking.value = false;
    }
};

const onSwitchToWorkspace = async () => {
    linkError.value = "";
    linking.value = true;
    try {
        const current = account.value || {};
        await linkAccount({ mode: "workspace", provider: current.provider || "claude-code", label: current.label || "", email: current.email || "" });
        await loadAccount();
    } catch (error) {
        linkError.value = error.message;
    } finally {
        linking.value = false;
    }
};

const onUnlink = async () => {
    linkError.value = "";
    unlinking.value = true;
    try {
        await unlinkAccount();
        await loadAccount();
    } catch (error) {
        linkError.value = error.message;
    } finally {
        unlinking.value = false;
    }
};

const onMint = async () => {
    mintError.value = "";
    if (!tokenForm.name.trim()) {
        mintError.value = t("Accounts.token_name_required");
        return;
    }
    mintBusy.value = true;
    try {
        minted.value = await mintToken({
            name: tokenForm.name.trim(),
            mode: tokenForm.mode,
            provider: tokenForm.provider,
            projectIds: tokenForm.projectId ? [tokenForm.projectId] : []
        });
        minting.value = false;
        tokenForm.name = "";
    } catch (error) {
        mintError.value = error.message;
    } finally {
        mintBusy.value = false;
    }
};

const onRevoke = async (tk) => {
    revoking.value = tk._id;
    try {
        await revokeToken(tk._id);
    } catch (error) {
        mintError.value = error.message;
    } finally {
        revoking.value = "";
    }
};

const copy = async (text, key) => {
    try {
        await navigator.clipboard.writeText(text);
        copied.value = key;
        setTimeout(() => { copied.value = ""; }, 1600);
    } catch (error) {
        copied.value = "";
    }
};

onMounted(async () => {
    await Promise.all([loadAccount(), loadTokens(), loadManifest(), loadRuns()]);
    /* No runs means no bar, so the people total is never asked for — an
       unbounded timesheet read for a card that will not render. */
    const charted = runWindow.value;
    if (charted) await loadPeopleHours(charted.start, charted.end);
    draftModes.value = [...(policy.value.allowedModes || MODES)];
    if (!allowed.value.includes(form.mode)) form.mode = allowed.value[0] || "personal";
    if (!allowed.value.includes(tokenForm.mode)) tokenForm.mode = allowed.value[0] || "personal";
});
</script>

<style>
@import "./accounts.css";

/* 27c paints people in brand and workspace agents in the same hue at 45%, so
   the two brand segments read as related without reading as the same bucket. */
.acct-bar__seg--people, .acct-legend__key.acct-bar__seg--people { background: var(--brand); }
.acct-bar__seg--workspace, .acct-legend__key.acct-bar__seg--workspace { background: var(--brand); opacity: .45; }
</style>
