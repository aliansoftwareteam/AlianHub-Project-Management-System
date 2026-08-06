<!--
    Automation Agents — company settings.

    Agents can be created, configured, paused, deleted — and run.

    Test is the important control on this page: it runs the agent for real against
    a task in its own scope, but withholds every mutation and shows what it WOULD
    have posted. Trusting an agent before you have watched it work once is not a
    reasonable thing to ask of anyone.

    A switched-on agent runs when it is @mentioned in a comment or assigned to a
    task. Activity lists every run including refused ones — a silent agent and a
    blocked agent look identical otherwise, and only one of them is a problem.

    An agent is a MEMBER, not a rule — it gets a name, an emoji, a scope and a set
    of permissions, and it will be assignable like a person.
-->
<template>
    <div class="position-re mySettingsWrapper p-1">
        <SpinnerComp :is-spinner="isSpinner" />
        <div class="my-settings-main">
            <div class="row">
                <div class="col-md-2 settingprofile">
                    <div class="col-md-10 settingprofileform setting_profile_mobile_responsive">
                        <div class="profileform agt">

                            <div class="agt-head">
                                <h3 class="agt-title">{{ $t('Agents.title') }}</h3>
                                <p class="agt-desc">{{ $t('Agents.desc') }}</p>
                            </div>

                            <!-- Said once, up front. Without this every test run
                                 fails with the same message and it looks like the
                                 agent is broken rather than unconfigured. -->
                            <div v-if="llmReason" class="agt-callout agt-callout--top">
                                <strong>{{ $t('Agents.no_model') }}</strong>
                                {{ llmReason }}
                            </div>
                            <!-- Agents use whichever provider LLM_PROVIDER selects,
                                 the same one as every other AI feature. Naming it
                                 saves an .env hunt to find out what is answering. -->
                            <p v-else-if="llmModel" class="agt-model">{{ $t('Agents.using_model', llmModel) }}</p>

                            <!-- Usage first: this is the number that decides whether
                                 the feature stays switched on. -->
                            <div class="agt-usage">
                                <div class="agt-usage__stats">
                                    <div class="agt-stat">
                                        <span class="agt-stat__n">{{ usage.runs }}</span>
                                        <span class="agt-stat__l">{{ $t('Agents.runs_this_month') }}</span>
                                    </div>
                                    <div class="agt-stat">
                                        <span class="agt-stat__n" :class="{ 'is-bad': usage.failed > 0 }">{{ usage.failed }}</span>
                                        <span class="agt-stat__l">{{ $t('Agents.failed') }}</span>
                                    </div>
                                    <div class="agt-stat">
                                        <span class="agt-stat__n">{{ formatTokens(usage.tokensIn + usage.tokensOut) }}</span>
                                        <span class="agt-stat__l">{{ $t('Agents.tokens') }}</span>
                                    </div>
                                    <!-- Already returned by the usage endpoint and never
                                         shown. An estimate, not a bill — see the title. -->
                                    <div class="agt-stat" v-if="usage.costEstimate" :title="$t('Agents.cost_hint')">
                                        <span class="agt-stat__n">~${{ usage.costEstimate.toFixed(2) }}</span>
                                        <span class="agt-stat__l">{{ $t('Agents.cost') }}</span>
                                    </div>
                                </div>
                                <button
                                    v-if="canManage && agents.length"
                                    type="button" class="agt-btn agt-btn--danger"
                                    :title="$t('Agents.pause_all_hint')"
                                    @click="pauseAll"
                                >{{ $t('Agents.pause_all') }}</button>
                            </div>

                            <!-- ── Create / edit, in the shared Sidebar ────
                                 One sidebar serves both: `editingId` decides the
                                 title and which endpoint save() calls. -->
                            <Sidebar
                                v-model:visible="isEditing"
                                :title="editingId ? $t('Agents.edit_agent') : $t('Agents.new_agent')"
                                width="560px"
                                :defaultLayout="false"
                                :closeOnBackDrop="false"
                                className="agt-sidebar"
                            >
                                <template #body>
                                    <div class="agt-sb">
                                        <div class="agt-sb__scroll">
                                            <div class="agt-sb__summary">
                                                <span class="agt-sb__avatar">{{ form.emoji || '🤖' }}</span>
                                                <p class="agt-sb__summary-text">{{ summaryLine }}</p>
                                            </div>

                                            <!-- Identity -->
                                            <div class="agt-group">
                                                <div class="agt-field agt-field--row">
                                                    <div class="agt-emoji-pick">
                                                        <label class="agt-label">{{ $t('Agents.icon') }}</label>
                                                        <select v-model="form.emoji" class="agt-input agt-input--emoji">
                                                            <option v-for="e in emojiChoices" :key="e" :value="e">{{ e }}</option>
                                                        </select>
                                                    </div>
                                                    <div class="agt-field agt-field--grow">
                                                        <label class="agt-label">{{ $t('Agents.name') }} <span class="agt-req">*</span></label>
                                                        <input type="text" class="agt-input" v-model.trim="form.name" :placeholder="$t('Agents.name_ph')" maxlength="60" />
                                                    </div>
                                                </div>

                                                <div class="agt-field">
                                                    <label class="agt-label">{{ $t('Agents.instructions') }} <span class="agt-req">*</span></label>
                                                    <textarea class="agt-input agt-textarea" v-model="form.instructions" rows="7" :placeholder="$t('Agents.instructions_ph')"></textarea>
                                                    <p class="agt-hint">{{ $t('Agents.instructions_hint') }}</p>
                                                </div>
                                            </div>

                                            <!-- Scope -->
                                            <div class="agt-group">
                                                <h5 class="agt-group__title">{{ $t('Agents.scope') }}</h5>
                                                <div class="agt-field agt-field--row">
                                                    <div class="agt-field agt-field--half">
                                                        <select v-model="form.scopeLevel" class="agt-input">
                                                            <option value="company">{{ $t('Agents.scope_company') }}</option>
                                                            <option value="project">{{ $t('Agents.scope_project') }}</option>
                                                        </select>
                                                    </div>
                                                    <div class="agt-field agt-field--half" v-if="form.scopeLevel === 'project'">
                                                        <select v-model="form.scopeRefId" class="agt-input" :disabled="!projects.length">
                                                            <option value="">{{ projects.length ? $t('Agents.pick_project') : $t('Agents.no_projects_short') }}</option>
                                                            <option v-for="p in projects" :key="p._id" :value="p._id">{{ p.ProjectName }}</option>
                                                        </select>
                                                    </div>
                                                </div>
                                                <!-- An empty dropdown otherwise reads as a broken page rather
                                                     than "you are not a member of any project yet". -->
                                                <p v-if="form.scopeLevel === 'project' && !projects.length" class="agt-hint agt-hint--warn">
                                                    {{ $t('Agents.no_projects') }}
                                                </p>
                                                <p class="agt-hint">{{ $t('Agents.scope_hint') }}</p>
                                            </div>

                                            <!-- Triggers -->
                                            <div class="agt-group">
                                                <h5 class="agt-group__title">{{ $t('Agents.triggers') }}</h5>
                                                <label class="agt-toggle">
                                                    <input type="checkbox" v-model="form.onMention" />
                                                    <span class="agt-toggle__box"></span>
                                                    <span class="agt-toggle__text">{{ $t('Agents.trigger_mention') }}</span>
                                                </label>
                                                <label class="agt-toggle">
                                                    <input type="checkbox" v-model="form.onAssigned" />
                                                    <span class="agt-toggle__box"></span>
                                                    <span class="agt-toggle__text">{{ $t('Agents.trigger_assigned') }}</span>
                                                </label>
                                                <p class="agt-hint">{{ $t('Agents.triggers_hint') }}</p>
                                            </div>

                                            <!-- Skills -->
                                            <div class="agt-group">
                                                <h5 class="agt-group__title">{{ $t('Agents.skills') }}</h5>
                                                <p class="agt-hint agt-hint--lead">{{ $t('Agents.skills_hint') }}</p>

                                                <div class="agt-skills">
                                                    <label v-for="s in readSkills" :key="s.key" class="agt-skill" :class="{ 'is-on': form.skills.includes(s.key) }">
                                                        <input type="checkbox" :value="s.key" v-model="form.skills" />
                                                        <span class="agt-toggle__box"></span>
                                                        <span class="agt-skill__body">
                                                            <span class="agt-skill__name">{{ s.name }}</span>
                                                            <span class="agt-skill__desc">{{ s.desc }}</span>
                                                        </span>
                                                    </label>
                                                </div>

                                                <div class="agt-divider">
                                                    <span>{{ $t('Agents.write_skills') }}</span>
                                                </div>
                                                <p class="agt-hint agt-hint--lead">{{ $t('Agents.write_skills_hint') }}</p>

                                                <div class="agt-skills">
                                                    <!-- `is-soon` / the disabled state stay for any skill the runner
                                                         cannot yet perform: granting one would put a "Can change
                                                         data" badge on an agent that provably cannot. Nothing is in
                                                         that state today, so neither renders. -->
                                                    <label
                                                        v-for="s in writeSkills" :key="s.key"
                                                        class="agt-skill agt-skill--write"
                                                        :class="{ 'is-on': form.skills.includes(s.key), 'is-soon': !s.available }"
                                                    >
                                                        <input type="checkbox" :value="s.key" v-model="form.skills" :disabled="!s.available" />
                                                        <span class="agt-toggle__box"></span>
                                                        <span class="agt-skill__body">
                                                            <span class="agt-skill__name">
                                                                {{ s.name }}
                                                                <span v-if="!s.available" class="agt-soon">{{ $t('Agents.soon') }}</span>
                                                            </span>
                                                            <span class="agt-skill__desc">{{ s.desc }}</span>
                                                        </span>
                                                    </label>
                                                </div>

                                                <div v-if="formHasWriteSkill" class="agt-callout">
                                                    {{ $t('Agents.write_warning') }}
                                                </div>
                                            </div>

                                            <!-- Limits -->
                                            <div class="agt-group agt-group--last">
                                                <h5 class="agt-group__title">{{ $t('Agents.limits') }}</h5>
                                                <label class="agt-toggle" v-if="formHasWriteSkill">
                                                    <input type="checkbox" v-model="form.requireApproval" />
                                                    <span class="agt-toggle__box"></span>
                                                    <span class="agt-toggle__text">
                                                        {{ $t('Agents.require_approval') }}
                                                        <span class="agt-toggle__hint">{{ $t('Agents.require_approval_hint') }}</span>
                                                    </span>
                                                </label>
                                                <div class="agt-field agt-field--narrow">
                                                    <label class="agt-label">{{ $t('Agents.runs_per_day') }}</label>
                                                    <input type="number" class="agt-input" v-model.number="form.runsPerDay" min="1" max="500" />
                                                    <p class="agt-hint">{{ $t('Agents.runs_per_day_hint') }}</p>
                                                </div>
                                            </div>

                                        </div>

                                        <div class="agt-sb__foot">
                                            <button type="button" class="agt-btn agt-btn--primary" :disabled="isSpinner" @click="save">
                                                {{ editingId ? $t('Agents.save') : $t('Agents.create') }}
                                            </button>
                                            <button type="button" class="agt-btn" @click="closeEditor">{{ $t('Agents.cancel') }}</button>
                                        </div>
                                    </div>
                                </template>
                            </Sidebar>

                            <!-- ── Tabs ───────────────────────────────────────
                                 Two jobs on one page: configure agents, and audit
                                 what they did. Stacked, the second was permanently
                                 below the fold and got longer with every run. The
                                 summary strip above stays visible for both, because
                                 it is the number that matters either way. -->
                            <div class="agt-tabs" role="tablist">
                                <button
                                    v-for="tab in tabs" :key="tab.key"
                                    type="button" class="agt-tab"
                                    :class="{ 'is-active': activeTab === tab.key }"
                                    role="tab" :aria-selected="activeTab === tab.key"
                                    @click="openTab(tab.key)"
                                >
                                    {{ tab.label }}
                                    <span v-if="tab.count" class="agt-count">{{ tab.count }}</span>
                                </button>
                            </div>

                            <!-- ── Agents ─────────────────────────────────── -->
                            <div v-show="activeTab === 'agents'" class="agt-list-wrap" role="tabpanel">
                                <div class="agt-list-head">
                                    <h4 class="agt-section-title">
                                        {{ $t('Agents.your_agents') }}
                                        <span class="agt-count" v-if="agents.length">{{ agents.length }}</span>
                                    </h4>
                                    <button type="button" class="agt-btn agt-btn--primary" @click="openEditor()">
                                        + {{ $t('Agents.new_agent') }}
                                    </button>
                                </div>

                                <div v-if="!agents.length && !isSpinner" class="agt-empty">
                                    <span class="agt-empty__icon">🤖</span>
                                    <p class="agt-empty__title">{{ $t('Agents.empty_title') }}</p>
                                    <p class="agt-empty__body">{{ $t('Agents.empty') }}</p>
                                </div>

                                <div v-for="agent in agents" :key="agent._id" class="agt-item">
                                    <div class="agt-row" :class="{ 'is-off': !agent.enabled, 'is-testing': isTesting(agent) }">
                                        <span class="agt-row__avatar" :style="{ background: tint(agent.colour), color: agent.colour || '#2F3990' }">{{ agent.emoji || '🤖' }}</span>

                                        <div class="agt-row__body">
                                            <div class="agt-row__name">
                                                {{ agent.name }}
                                                <span class="agt-pill" :class="agent.enabled ? 'is-on' : 'is-off'">
                                                    {{ agent.enabled ? $t('Agents.enabled') : $t('Agents.paused') }}
                                                </span>
                                                <span class="agt-pill is-scope">{{ scopeLabelFor(agent) }}</span>
                                                <span v-if="agent.hasWriteSkill" class="agt-pill is-write">{{ $t('Agents.can_write') }}</span>
                                            </div>
                                            <p v-if="agent.description" class="agt-row__desc">{{ agent.description }}</p>
                                            <p class="agt-row__meta">{{ agent.triggerLabel }} &middot; {{ skillSummary(agent) }}</p>
                                        </div>

                                        <div class="agt-row__actions">
                                            <label class="agt-switch" :title="agent.enabled ? $t('Agents.paused') : $t('Agents.enabled')">
                                                <input type="checkbox" :checked="agent.enabled" @change="toggle(agent)" />
                                                <span class="agt-slider"></span>
                                            </label>
                                            <button type="button" class="agt-link" @click="toggleTest(agent)">{{ $t('Agents.test') }}</button>
                                            <button type="button" class="agt-link" @click="openEditor(agent)">{{ $t('Agents.edit') }}</button>
                                            <button type="button" class="agt-link agt-link--danger" @click="remove(agent)">{{ $t('Agents.delete') }}</button>
                                        </div>
                                    </div>

                                    <!-- Test run: a rehearsal, expanded under the agent it
                                         belongs to so there is no doubt which one is running. -->
                                    <div v-if="isTesting(agent)" class="agt-test">
                                        <p class="agt-test__note">{{ $t('Agents.test_note') }}</p>

                                        <div v-if="!testTasks.length && !testLoading" class="agt-hint">{{ $t('Agents.no_tasks_in_scope') }}</div>
                                        <div v-else class="agt-test__controls">
                                            <select v-model="testTaskId" class="agt-input agt-test__pick" :disabled="testLoading || testBusy">
                                                <option value="">{{ $t('Agents.pick_task') }}</option>
                                                <option v-for="tk in testTasks" :key="tk._id" :value="tk._id">
                                                    {{ tk.taskId ? `#${tk.taskId} — ` : '' }}{{ tk.name }}
                                                </option>
                                            </select>
                                            <button
                                                type="button" class="agt-btn agt-btn--primary"
                                                :disabled="!testTaskId || testBusy"
                                                @click="runTest(agent)"
                                            >{{ testBusy ? $t('Agents.testing') : $t('Agents.run_test') }}</button>
                                            <button type="button" class="agt-btn" @click="closeTest">{{ $t('Agents.close') }}</button>
                                        </div>

                                        <div v-if="testResult" class="agt-test__out" :class="{ 'is-bad': !testResult.ok }">
                                            <span class="agt-test__out-label">
                                                {{ testResult.ok ? $t('Agents.test_would_post') : $t('Agents.test_failed') }}
                                            </span>
                                            <p class="agt-test__out-body">{{ testResult.text }}</p>
                                            <p v-if="testResult.ok && testResult.tokens" class="agt-test__out-meta">
                                                {{ $t('Agents.n_tokens', { count: testResult.tokens }) }}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <p class="agt-footnote">{{ $t('Agents.not_running_yet') }}</p>
                            </div>

                            <!-- ── Activity ───────────────────────────────────
                                 An agent nobody can audit is an agent nobody
                                 should trust. Refused runs are listed too — a
                                 silent agent and a blocked agent look identical
                                 without this. -->
                            <div v-show="activeTab === 'activity'" class="agt-activity" role="tabpanel">
                                <div class="agt-list-head">
                                    <!-- No heading: the tab is the heading. -->
                                    <p class="agt-desc agt-desc--sm agt-desc--flush">{{ $t('Agents.activity_desc') }}</p>
                                    <div class="agt-activity__tools">
                                        <!-- Filtering by agent is what turns this from a
                                             feed into something you can answer a question
                                             with: which agent is spending the tokens. -->
                                        <select v-model="runFilterAgentId" class="agt-input agt-activity__filter">
                                            <option value="">{{ $t('Agents.all_agents') }}</option>
                                            <option v-for="a in runFilterOptions" :key="a.agentId" :value="a.agentId">
                                                {{ a.agentName }}
                                            </option>
                                        </select>
                                        <button type="button" class="agt-link" @click="loadRuns(runPage)">{{ $t('Agents.refresh') }}</button>
                                    </div>
                                </div>

                                <!-- Per-agent totals for the month. Answers "who used
                                     what" directly instead of making you add up rows. -->
                                <div v-if="usage.byAgent && usage.byAgent.length" class="agt-spend">
                                    <div
                                        v-for="a in usage.byAgent" :key="'spend_' + a.agentId"
                                        class="agt-spend__row"
                                        :class="{ 'is-picked': runFilterAgentId === a.agentId }"
                                        role="button" tabindex="0"
                                        :title="$t('Agents.filter_to_agent')"
                                        @click="pickAgentFilter(a.agentId)"
                                        @keyup.enter="pickAgentFilter(a.agentId)"
                                    >
                                        <span class="agt-spend__name">{{ a.agentName || $t('Agents.title') }}</span>
                                        <span class="agt-spend__n">{{ $t('Agents.n_runs', { count: a.runs }) }}</span>
                                        <span class="agt-spend__n">{{ formatTokens(a.tokensIn + a.tokensOut) }}</span>
                                        <span class="agt-spend__n agt-spend__n--bad" v-if="a.failed">{{ a.failed }} {{ $t('Agents.failed') }}</span>
                                    </div>
                                </div>

                                <p v-if="!runs.length" class="agt-hint">
                                    {{ runFilterAgentId ? $t('Agents.no_runs_for_agent') : $t('Agents.no_runs') }}
                                </p>

                                <div v-else class="agt-table-wrap">
                                    <table class="agt-table">
                                        <!-- Explicit widths. Left to itself the browser
                                             gave Agent most of the row and stretched
                                             Tokens so its numbers floated far from the
                                             heading. Result takes the slack because it
                                             is the only column with sentences in it. -->
                                        <colgroup>
                                            <col class="agt-col--agent" />
                                            <col class="agt-col--trigger" />
                                            <col class="agt-col--result" />
                                            <col class="agt-col--tokens" />
                                            <col class="agt-col--when" />
                                        </colgroup>
                                        <thead>
                                            <tr>
                                                <th>{{ $t('Agents.col_agent') }}</th>
                                                <th>{{ $t('Agents.col_trigger') }}</th>
                                                <th>{{ $t('Agents.col_status') }}</th>
                                                <th class="agt-table__num">{{ $t('Agents.col_tokens') }}</th>
                                                <th>{{ $t('Agents.col_when') }}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr v-for="run in runs" :key="run._id">
                                                <td>
                                                    <span class="agt-run__dot" :class="`is-${run.status}`"></span>
                                                    {{ run.agentName || $t('Agents.title') }}
                                                </td>
                                                <td><span class="agt-pill">{{ triggerLabel(run.triggerType) }}</span></td>
                                                <td>
                                                    <span class="agt-pill" :class="runPillClass(run.status)">{{ statusLabel(run.status) }}</span>
                                                    <!-- A run that succeeded but said nothing is still a
                                                         result; "Done" alone would read as broken. -->
                                                    <span v-if="run.note" class="agt-run__note">{{ run.note }}</span>
                                                    <span v-if="run.error" class="agt-run__err">{{ run.error }}</span>
                                                </td>
                                                <td class="agt-table__num">{{ (run.tokensIn || 0) + (run.tokensOut || 0) || '—' }}</td>
                                                <td class="agt-table__when">{{ timeAgo(run.startedAt) }}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>

                                <div v-if="runPages > 1" class="agt-pager">
                                    <button type="button" class="agt-btn" :disabled="runPage <= 1" @click="loadRuns(runPage - 1)">
                                        {{ $t('Agents.prev') }}
                                    </button>
                                    <span class="agt-pager__at">{{ $t('Agents.page_of', { page: runPage, pages: runPages }) }}</span>
                                    <button type="button" class="agt-btn" :disabled="runPage >= runPages" @click="loadRuns(runPage + 1)">
                                        {{ $t('Agents.next') }}
                                    </button>
                                </div>
                            </div>

                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
// Named (multi-word) to satisfy vue/multi-word-component-names; the route and
// file stay "Agents".
export default { name: 'AutomationAgentsSettings' };
</script>

<script setup>
import * as env from '@/config/env';
import { useToast } from 'vue-toast-notification';
import { ref, computed, watch, onMounted } from 'vue';
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
import { apiRequest } from '../../../services';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const $toast = useToast();

const isSpinner = ref(false);
const agents = ref([]);
const canManage = ref(false);
const catalogue = ref({ skills: [], writeSkillKeys: [], defaultLimits: { runsPerDay: 50, requireApproval: true } });
const usage = ref({ runs: 0, failed: 0, tokensIn: 0, tokensOut: 0, costEstimate: 0, byAgent: [] });

const isEditing = ref(false);
const editingId = ref('');

// ── test run ───────────────────────────────────────────────────────────────
// One panel at a time, tied to an agent id: opening a second closes the first,
// so the task list and the result on screen always belong to the same agent.
const testingId = ref('');
const testTasks = ref([]);
const testTaskId = ref('');
const testLoading = ref(false);
const testBusy = ref(false);
const testResult = ref(null);

// ── tabs ───────────────────────────────────────────────────────────────────
// Agents first: that is what someone comes here to change. Activity is where they
// go to check on it afterwards.
const activeTab = ref('agents');
const runsLoaded = ref(false);

const tabs = computed(() => [
    { key: 'agents', label: t('Agents.tab_agents'), count: agents.value.length },
    // The count comes from the usage total, which is loaded up front, so the tab
    // shows a number before the log itself has ever been fetched.
    { key: 'activity', label: t('Agents.tab_activity'), count: runTotal.value || usage.value.runs || 0 },
]);

const openTab = (key) => {
    activeTab.value = key;
    // Deferred until first opened. Most visits here are to change an agent, and the
    // run log is the one request that grows with usage.
    if (key === 'activity' && !runsLoaded.value) loadRuns(1);
};

// ── activity log ───────────────────────────────────────────────────────────
// Paged server-side: one row per run, forever, so this cannot be fetched whole.
const runs = ref([]);
const runTotal = ref(0);
const runPage = ref(1);
const runFilterAgentId = ref('');
const RUNS_PER_PAGE = 10;

const emojiChoices = ['🤖', '🐛', '📋', '📊', '🔍', '✅', '⏰', '💬', '🧭', '🛠️'];

const blankForm = () => ({
    name: '',
    emoji: '🤖',
    instructions: '',
    scopeLevel: 'company',
    scopeRefId: '',
    onMention: true,
    onAssigned: false,
    // A new agent starts able to read its scope and reply — nothing more. Write
    // skills are opted into deliberately.
    skills: ['context.read', 'comment.write'],
    requireApproval: true,
    runsPerDay: 50,
});
const form = ref(blankForm());

// Loaded from the agents API, not the Vuex project store: that store is only
// populated by the Projects area, so arriving straight at Settings left this empty
// and the dropdown had nothing in it. The endpoint also applies the same access
// rule the save path enforces, so every project listed here can actually be saved.
const projects = ref([]);

// Empty when a model IS configured, so the banner is driven by one value.
const llmReason = computed(() => {
    const llm = catalogue.value.llm;
    return llm && !llm.ready ? String(llm.reason || '') : '';
});

// Null unless a model is both configured and named, so the line is only rendered
// when it can say something true.
const llmModel = computed(() => {
    const llm = catalogue.value.llm;
    if (!llm || !llm.ready || !llm.model) return null;
    return { provider: String(llm.provider || ''), model: String(llm.model) };
});

const readSkills = computed(() => (catalogue.value.skills || []).filter((s) => !s.write));
const writeSkills = computed(() => (catalogue.value.skills || []).filter((s) => s.write));
// Only skills that can actually be granted count toward the approval toggle and
// the data-change warning — a warning about something impossible teaches people
// to dismiss warnings.
//
// Taken from the server's own list rather than from the checkboxes above, because some
// write skills are implemented but withheld from the form. Deriving it from what is
// rendered would hide the approval control from an agent that holds only one of those —
// it would still change data, just with no warning and no way to require approval.
const writeKeys = computed(() => (
    catalogue.value.writeSkillKeys && catalogue.value.writeSkillKeys.length
        ? catalogue.value.writeSkillKeys
        : writeSkills.value.filter((s) => s.available).map((s) => s.key)
));
const formHasWriteSkill = computed(() => form.value.skills.some((k) => writeKeys.value.includes(k)));

/**
 * Plain-English summary of the agent being edited, shown in the card header.
 * Reading back a configuration as a sentence is how someone notices they've
 * built something they didn't mean to.
 */
const summaryLine = computed(() => {
    const when = [];
    if (form.value.onMention) when.push(t('Agents.sum_mentioned'));
    if (form.value.onAssigned) when.push(t('Agents.sum_assigned'));
    const trigger = when.length ? when.join(t('Agents.sum_or')) : t('Agents.sum_never');

    const where = form.value.scopeLevel === 'company'
        ? t('Agents.sum_everywhere')
        : (projects.value.find((p) => String(p._id) === String(form.value.scopeRefId)) || {}).ProjectName
            || t('Agents.sum_one_project');

    const can = formHasWriteSkill.value ? t('Agents.sum_can_change') : t('Agents.sum_read_only');
    return t('Agents.summary', { trigger, where, can });
});

const ok = (res) => Boolean(res && res.data && res.data.status);
const errText = (res, fallback) => (res && res.data && res.data.statusText) || fallback;

const tint = (colour) => `${colour || '#2F3990'}14`;

const formatTokens = (n) => {
    const v = Number(n) || 0;
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return String(v);
};

const scopeLabelFor = (agent) => {
    const level = (agent.scope && agent.scope.level) || 'company';
    if (level === 'company') return t('Agents.scope_company_short');
    if (level === 'project') {
        const p = projects.value.find((x) => String(x._id) === String(agent.scope.refId));
        return p ? p.ProjectName : t('Agents.scope_project_short');
    }
    return agent.scopeLabel || level;
};

const skillSummary = (agent) => {
    const n = (agent.skills || []).length;
    return n === 1 ? t('Agents.one_skill') : t('Agents.n_skills', { count: n });
};

const STATUS_LABELS = {
    done: 'Agents.status_done',
    failed: 'Agents.status_failed',
    skipped: 'Agents.status_skipped',
    running: 'Agents.status_running',
};
const TRIGGER_LABELS = {
    test: 'Agents.trigger_test_label',
    manual: 'Agents.trigger_manual_label',
    mention: 'Agents.trigger_mention_label',
    assigned: 'Agents.trigger_assigned_label',
    // Historical only. Agents briefly answered every comment on a task they were
    // attached to; that was removed, but those run rows still exist and would
    // otherwise render the raw key "comment".
    comment: 'Agents.trigger_comment_label',
};

const statusLabel = (status) => (STATUS_LABELS[status] ? t(STATUS_LABELS[status]) : String(status || ''));
const triggerLabel = (type) => (TRIGGER_LABELS[type] ? t(TRIGGER_LABELS[type]) : String(type || ''));

// "Refused" is not a failure — an agent stopped by its own daily limit is the
// safety net working, and colouring it red would train people to ignore red.
const runPillClass = (status) => {
    if (status === 'done') return 'is-on';
    if (status === 'failed') return 'is-bad';
    return 'is-off';
};

const timeAgo = (value) => {
    const then = value ? new Date(value).getTime() : 0;
    if (!then || Number.isNaN(then)) return '';
    const mins = Math.floor((Date.now() - then) / 60000);
    if (mins < 1) return t('Agents.just_now');
    if (mins < 60) return t('Agents.mins_ago', { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('Agents.hours_ago', { count: hours });
    return t('Agents.days_ago', { count: Math.floor(hours / 24) });
};

// ── loading ────────────────────────────────────────────────────────────────
const loadCatalogue = async () => {
    try {
        const res = await apiRequest('get', `${env.AGENTS}/catalogue`);
        if (ok(res)) {
            catalogue.value = res.data.data;
            canManage.value = !!res.data.data.canManage;
        }
    } catch (error) {
        console.error('Could not load the agent catalogue', error);
    }
};

const loadProjects = async () => {
    try {
        const res = await apiRequest('get', `${env.AGENTS}/scope-options`);
        if (ok(res)) {
            projects.value = res.data.data.projects || [];
            canManage.value = !!res.data.data.canManage;
        }
    } catch (error) {
        // The editor still works for a company-wide agent without this.
        console.error('Could not load projects for agent scope', error);
    }
};

const loadAgents = async () => {
    try {
        const res = await apiRequest('get', env.AGENTS);
        if (ok(res)) {
            agents.value = res.data.data.agents || [];
            canManage.value = !!res.data.data.canManage;
        }
    } catch (error) {
        console.error('Could not load agents', error);
    }
};

const loadUsage = async () => {
    try {
        const res = await apiRequest('get', `${env.AGENTS}/usage`);
        if (ok(res)) usage.value = { ...usage.value, ...res.data.data };
    } catch (error) {
        // Usage is a decoration on this page — never let it block the list.
        console.error('Could not load agent usage', error);
    }
};

const runPages = computed(() => Math.max(1, Math.ceil(runTotal.value / RUNS_PER_PAGE)));

/**
 * The agent filter's options.
 *
 * Built from the usage breakdown rather than the agent list, so an agent that has
 * been deleted still appears while its runs are in the log — its history is the
 * reason the log is kept.
 */
const runFilterOptions = computed(() => {
    const seen = new Map();
    (usage.value.byAgent || []).forEach((a) => {
        if (a.agentId) seen.set(a.agentId, { agentId: a.agentId, agentName: a.agentName || t('Agents.title') });
    });
    agents.value.forEach((a) => {
        const id = String(a._id);
        if (!seen.has(id)) seen.set(id, { agentId: id, agentName: a.name });
    });
    return [...seen.values()].sort((a, b) => String(a.agentName).localeCompare(String(b.agentName)));
});

const loadRuns = async (page = 1) => {
    const want = Math.max(1, Number(page) || 1);
    try {
        const params = new URLSearchParams({ page: String(want), limit: String(RUNS_PER_PAGE) });
        if (runFilterAgentId.value) params.set('agentId', runFilterAgentId.value);
        const res = await apiRequest('get', `${env.AGENTS}/runs?${params.toString()}`);
        if (!ok(res)) return;
        const d = res.data.data || {};
        runs.value = d.rows || [];
        runTotal.value = Number(d.total) || 0;
        runPage.value = Number(d.page) || want;
        runsLoaded.value = true;

        // Deleting the last row of the last page would otherwise leave the user on an
        // empty page with no way to tell why.
        if (!runs.value.length && runPage.value > 1) await loadRuns(runPage.value - 1);
    } catch (error) {
        console.error('Could not load agent activity', error);
    }
};

// Changing the filter always returns to page 1 — page 4 of one agent's history is
// not page 4 of another's.
watch(runFilterAgentId, () => loadRuns(1));

/** Clicking a row in the spend table filters to it, or clears it if already picked. */
const pickAgentFilter = (agentId) => {
    runFilterAgentId.value = runFilterAgentId.value === agentId ? '' : agentId;
};

// ── test run ───────────────────────────────────────────────────────────────
const isTesting = (agent) => testingId.value === String(agent._id);

const closeTest = () => {
    testingId.value = '';
    testTasks.value = [];
    testTaskId.value = '';
    testResult.value = null;
};

const toggleTest = async (agent) => {
    if (isTesting(agent)) {
        closeTest();
        return;
    }
    closeTest();
    testingId.value = String(agent._id);
    testLoading.value = true;
    // Both the result and the loading flag are checked against this, so a slow
    // reply for an agent the user has already moved on from cannot land in — or
    // switch off the spinner for — the panel that is now open.
    const opened = String(agent._id);
    const stillMine = () => testingId.value === opened;
    try {
        const res = await apiRequest('get', `${env.AGENTS}/${agent._id}/test-targets`);
        if (!stillMine()) return;
        if (ok(res)) testTasks.value = res.data.data.tasks || [];
        else $toast.error(errText(res, t('Agents.save_failed')), { position: 'top-right' });
    } catch (error) {
        if (stillMine()) $toast.error(error?.message || t('Agents.save_failed'), { position: 'top-right' });
    } finally {
        if (stillMine()) testLoading.value = false;
    }
};

const runTest = async (agent) => {
    if (!testTaskId.value) return;
    testBusy.value = true;
    testResult.value = null;
    try {
        const res = await apiRequest('post', `${env.AGENTS}/${agent._id}/test-run`, { taskId: testTaskId.value });
        const payload = (res && res.data) || {};
        const outcome = payload.data || {};

        if (payload.status) {
            // A run can succeed and still have nothing to say — that is a result,
            // not an empty box.
            testResult.value = {
                ok: true,
                text: outcome.comment || t('Agents.test_said_nothing'),
                tokens: (Number(outcome.tokensIn) || 0) + (Number(outcome.tokensOut) || 0),
            };
        } else {
            // The exact reason, not a generic failure: "no API key", "outside its
            // scope" and "over its daily limit" need completely different fixes.
            testResult.value = { ok: false, text: payload.statusText || t('Agents.save_failed') };
        }
    } catch (error) {
        testResult.value = { ok: false, text: error?.message || t('Agents.save_failed') };
    } finally {
        testBusy.value = false;
        // A test is a run: it counts against the budget and appears in Activity.
        // The log is only refetched if it is already on screen — usage always is,
        // since the summary strip shows it whichever tab you are on.
        if (runsLoaded.value) loadRuns(1);
        loadUsage();
    }
};

// ── editor ─────────────────────────────────────────────────────────────────
const openEditor = (agent) => {
    if (agent) {
        editingId.value = String(agent._id);
        const limits = agent.limits || {};
        form.value = {
            name: agent.name || '',
            emoji: agent.emoji || '🤖',
            instructions: agent.instructions || '',
            scopeLevel: (agent.scope && agent.scope.level) || 'company',
            scopeRefId: (agent.scope && agent.scope.refId) ? String(agent.scope.refId) : '',
            onMention: (agent.triggers || []).some((x) => x.type === 'mention'),
            onAssigned: (agent.triggers || []).some((x) => x.type === 'assigned'),
            skills: [...(agent.skills || [])],
            requireApproval: limits.requireApproval !== false,
            runsPerDay: Number(limits.runsPerDay) || 50,
        };
    } else {
        editingId.value = '';
        form.value = blankForm();
    }
    isEditing.value = true;
};

const closeEditor = () => {
    isEditing.value = false;
};

// The Sidebar closes itself when its ✕ is clicked, emitting update:visible rather
// than calling closeEditor(). Resetting here means every close path — ✕, Cancel,
// or a successful save — leaves the same clean state behind.
watch(isEditing, (open) => {
    if (!open) {
        editingId.value = '';
        form.value = blankForm();
    }
});

const buildPayload = () => {
    const triggers = [];
    if (form.value.onMention) triggers.push({ type: 'mention' });
    if (form.value.onAssigned) triggers.push({ type: 'assigned' });
    return {
        name: form.value.name,
        emoji: form.value.emoji,
        instructions: form.value.instructions,
        scope: {
            level: form.value.scopeLevel,
            refId: form.value.scopeLevel === 'company' ? null : form.value.scopeRefId,
        },
        triggers,
        skills: form.value.skills,
        limits: {
            runsPerDay: form.value.runsPerDay,
            requireApproval: form.value.requireApproval,
        },
    };
};

const save = async () => {
    if (!form.value.name.trim()) {
        $toast.error(t('Agents.name_required'), { position: 'top-right' });
        return;
    }
    if (!form.value.instructions.trim()) {
        $toast.error(t('Agents.instructions_required'), { position: 'top-right' });
        return;
    }
    if (form.value.scopeLevel === 'project' && !form.value.scopeRefId) {
        $toast.error(t('Agents.project_required'), { position: 'top-right' });
        return;
    }

    isSpinner.value = true;
    try {
        const payload = buildPayload();
        const res = editingId.value
            ? await apiRequest('put', `${env.AGENTS}/${editingId.value}`, payload)
            : await apiRequest('post', env.AGENTS, payload);
        if (!ok(res)) {
            $toast.error(errText(res, t('Agents.save_failed')), { position: 'top-right' });
            return;
        }
        $toast.success(editingId.value ? t('Agents.saved') : t('Agents.created_paused'), { position: 'top-right' });
        closeEditor();
        await loadAgents();
        // A rename rewrites the name on past runs, so Activity on screen is now
        // stale — but only refresh if it has actually been loaded, or this would
        // undo the lazy fetch the tab exists to avoid.
        if (runsLoaded.value) loadRuns(runPage.value);
        loadUsage();
    } catch (error) {
        $toast.error(error?.message || t('Agents.save_failed'), { position: 'top-right' });
    } finally {
        isSpinner.value = false;
    }
};

const toggle = async (agent) => {
    const next = !agent.enabled;
    try {
        const res = await apiRequest('post', `${env.AGENTS}/${agent._id}/toggle`, { enabled: next });
        if (!ok(res)) {
            $toast.error(errText(res, t('Agents.save_failed')), { position: 'top-right' });
            await loadAgents();   // put the switch back where it was
            return;
        }
        agent.enabled = next;
    } catch (error) {
        $toast.error(error?.message || t('Agents.save_failed'), { position: 'top-right' });
        await loadAgents();
    }
};

const remove = async (agent) => {
    if (!window.confirm(t('Agents.confirm_delete', { name: agent.name }))) return;
    // The panel belongs to this agent; leaving it open would strand a task list
    // and a result for something that no longer exists.
    if (isTesting(agent)) closeTest();
    isSpinner.value = true;
    try {
        const res = await apiRequest('delete', `${env.AGENTS}/${agent._id}`);
        if (!ok(res)) {
            $toast.error(errText(res, t('Agents.save_failed')), { position: 'top-right' });
            return;
        }
        $toast.success(t('Agents.deleted', { name: agent.name }), { position: 'top-right' });
        await loadAgents();
    } catch (error) {
        $toast.error(error?.message || t('Agents.save_failed'), { position: 'top-right' });
    } finally {
        isSpinner.value = false;
    }
};

const pauseAll = async () => {
    if (!window.confirm(t('Agents.confirm_pause_all'))) return;
    isSpinner.value = true;
    try {
        const res = await apiRequest('post', `${env.AGENTS}/disable-all`, {});
        if (!ok(res)) {
            $toast.error(errText(res, t('Agents.save_failed')), { position: 'top-right' });
            return;
        }
        $toast.success(t('Agents.all_paused'), { position: 'top-right' });
        await loadAgents();
    } catch (error) {
        $toast.error(error?.message || t('Agents.save_failed'), { position: 'top-right' });
    } finally {
        isSpinner.value = false;
    }
};

onMounted(() => {
    loadCatalogue();
    loadProjects();
    loadAgents();
    // Not loadRuns(): the Activity tab fetches its own data the first time it is
    // opened, so landing here costs one request fewer. The usage totals are still
    // loaded, because the strip and the tab count both need them.
    loadUsage();
});
</script>

<style scoped>
@import '../MySettings/style.css';

/* The shared settings stylesheet pins inputs to width:278px and paints every
   .btn_btn navy with !important. Neither suits a form this dense, so this page
   uses its own .agt-input / .agt-btn rather than fighting those rules — a ghost
   button built on .btn_btn ends up navy-on-navy and unreadable. */

/* Full width. This was capped at 860px, which left most of the card empty while the
   page itself ran several screens long — the run table in particular has five
   columns and wants the room. Prose is still capped per-element (.agt-desc) so the
   text does not become a single unreadable line. */
.agt { width: 100%; }

/* ── tabs ──────────────────────────────────────────────── */
.agt-tabs {
    display: flex;
    gap: 2px;
    margin: 0 0 20px;
    border-bottom: 1px solid #E7E9F3;
}
.agt-tab {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 9px 15px;
    margin-bottom: -1px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 550;
    color: #6B7280;
    background: none;
    border: 0;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: color 0.12s ease, border-color 0.12s ease;
}
.agt-tab:hover { color: #2A2C39; }
.agt-tab.is-active { color: #2F3990; border-bottom-color: #2F3990; font-weight: 650; }
.agt-tab:focus-visible { outline: 2px solid #2F3990; outline-offset: -2px; border-radius: 4px 4px 0 0; }
/* The count sits on the tab, so it reads at a glance without switching. */
.agt-tab .agt-count { background: #F1F2F6; color: #8A909C; }
.agt-tab.is-active .agt-count { background: #EEF0FE; color: #6473E8; }

.agt-head { margin-bottom: 20px; }
.agt-title { font-size: 19px; font-weight: 650; color: #1F212A; margin: 0 0 5px; letter-spacing: -0.01em; }
.agt-desc { font-size: 13px; color: #6B7280; margin: 0; max-width: 66ch; line-height: 1.6; }

/* ── usage ─────────────────────────────────────────────── */
.agt-usage {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    padding: 15px 20px;
    margin-bottom: 26px;
    background: linear-gradient(180deg, #FBFCFF 0%, #F7F8FD 100%);
    border: 1px solid #E7E9F3;
    border-left: 3px solid #2F3990;
    border-radius: 8px;
}
.agt-usage__stats { display: flex; flex-wrap: wrap; gap: 34px; }
.agt-stat { display: flex; flex-direction: column; gap: 1px; }
.agt-stat__n { font-size: 21px; font-weight: 650; color: #1F212A; line-height: 1.15; font-variant-numeric: tabular-nums; }
.agt-stat__n.is-bad { color: #C62828; }
.agt-stat__l { font-size: 10.5px; color: #8A909C; text-transform: uppercase; letter-spacing: 0.07em; }

/* ── buttons (standalone: never .btn_btn) ──────────────── */
.agt-btn {
    padding: 8px 15px;
    font-size: 13px;
    font-weight: 550;
    font-family: inherit;
    color: #2A2C39;
    background: #fff;
    border: 1px solid #D6D9E4;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
}
.agt-btn:hover { background: #F4F5FB; border-color: #C2C7D8; }
.agt-btn--primary { color: #fff; background: #2F3990; border-color: #2F3990; }
.agt-btn--primary:hover { background: #262E75; border-color: #262E75; }
.agt-btn--primary:disabled { opacity: 0.55; cursor: default; }
.agt-btn--danger { margin-left: auto; color: #C62828; background: #FFF6F6; border-color: #F1C6C6; }
.agt-btn--danger:hover { background: #FDEBEB; border-color: #E5A9A9; }
.agt-btn:focus-visible { outline: 2px solid #2F3990; outline-offset: 2px; }

/* ── editor, inside the shared Sidebar ─────────────────── */
/* Sidebar teleports to #my-sidebar, which main.js appends INSIDE #app — so the
   app font is inherited and scoped styles still reach it, because the content is
   still rendered by this component. .sidebar-body owns the height and its own
   scroll, so this is a flex column: the fields scroll, the footer stays put. */
.agt-sb { display: flex; flex-direction: column; height: 100%; }
.agt-sb__scroll { flex: 1 1 auto; overflow-y: auto; min-height: 0; }
.agt-sb__foot {
    flex: 0 0 auto;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    padding: 14px 20px;
    background: #FBFCFF;
    border-top: 1px solid #E7E9F3;
}

/* Reads the configuration back as a sentence — how someone notices they have
   built something they did not mean to. */
.agt-sb__summary {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    background: #F7F8FD;
    border-bottom: 1px solid #EDEFF5;
}
.agt-sb__avatar {
    display: inline-flex; align-items: center; justify-content: center;
    width: 36px; height: 36px; flex: none;
    font-size: 18px;
    background: #fff;
    border: 1px solid #E3E5EE;
    border-radius: 9px;
}
.agt-sb__summary-text { font-size: 12.5px; color: #4A4C5A; margin: 0; line-height: 1.5; }

/* ── groups + fields ──────────────────────────────────── */
.agt-group { padding: 20px 22px; border-bottom: 1px solid #F1F2F8; }
.agt-group--last { border-bottom: 0; }
.agt-group__title {
    font-size: 11px; font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase;
    color: #6473E8; margin: 0 0 14px;
}

.agt-field { display: flex; flex-direction: column; margin-bottom: 16px; }
.agt-field:last-child { margin-bottom: 0; }
.agt-field--row { flex-direction: row; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
.agt-field--grow { flex: 1 1 240px; margin-bottom: 0; }
.agt-field--half { flex: 1 1 220px; margin-bottom: 0; }
.agt-field--narrow { max-width: 180px; }
.agt-emoji-pick { display: flex; flex-direction: column; flex: none; }

.agt-label { font-size: 12.5px; font-weight: 550; color: #2A2C39; margin-bottom: 6px; }
.agt-req { color: #C62828; }

.agt-input {
    width: 100%;
    max-width: 100%;
    padding: 9px 11px;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.45;
    color: #1F212A;
    background: #fff;
    border: 1px solid #DADDE8;
    border-radius: 6px;
}
.agt-input:hover { border-color: #C2C7D8; }
.agt-input:focus { outline: 0; border-color: #2F3990; box-shadow: 0 0 0 3px rgba(47, 57, 144, 0.1); }
.agt-input--emoji { width: 68px; text-align: center; font-size: 16px; cursor: pointer; }
select.agt-input { cursor: pointer; }
.agt-textarea { min-height: 132px; resize: vertical; line-height: 1.6; }

.agt-hint { font-size: 11.5px; color: #8A909C; margin: 6px 0 0; line-height: 1.55; max-width: 68ch; }
.agt-hint--lead { margin: -6px 0 14px; }
.agt-hint--warn { color: #8A5A0B; }

/* ── checkbox rows ─────────────────────────────────────── */
.agt-toggle {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 8px 0; margin: 0; cursor: pointer;
}
.agt-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
.agt-toggle__box {
    flex: none; position: relative;
    width: 16px; height: 16px; margin-top: 1px;
    background: #fff;
    border: 1.5px solid #C7CBDA;
    border-radius: 4px;
    transition: background 0.12s ease, border-color 0.12s ease;
}
.agt-toggle__box::after {
    content: ""; position: absolute;
    left: 4px; top: 0.5px;
    width: 5px; height: 9px;
    border: solid #fff; border-width: 0 2px 2px 0;
    transform: rotate(45deg) scale(0);
    transition: transform 0.12s ease;
}
/* The checked state belongs to the box, not to one of its two containers. Scoped to
   .agt-toggle it never matched a skill's checkbox, so ticking a skill only tinted the
   row — the square stayed empty and the tick never appeared. */
.agt-toggle input:checked + .agt-toggle__box,
.agt-skill input:checked + .agt-toggle__box { background: #2F3990; border-color: #2F3990; }
.agt-toggle input:checked + .agt-toggle__box::after,
.agt-skill input:checked + .agt-toggle__box::after { transform: rotate(45deg) scale(1); }
.agt-toggle input:focus-visible + .agt-toggle__box,
.agt-skill input:focus-visible + .agt-toggle__box { outline: 2px solid #2F3990; outline-offset: 2px; }
.agt-toggle__text { font-size: 13px; color: #2A2C39; line-height: 1.45; }
.agt-toggle__hint { display: block; font-size: 11.5px; color: #8A909C; margin-top: 2px; }

/* ── skills ────────────────────────────────────────────── */
.agt-skills { display: flex; flex-direction: column; gap: 2px; }
.agt-skill {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    align-items: start;
    gap: 11px;
    padding: 9px 11px;
    margin: 0;
    border: 1px solid transparent;
    border-radius: 7px;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
}
.agt-skill input { position: absolute; opacity: 0; width: 0; height: 0; }
.agt-skill:hover { background: #F6F7FC; }
.agt-skill.is-on { background: #F4F6FF; border-color: #DDE3FF; }
.agt-skill__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.agt-skill__name { font-size: 13px; font-weight: 600; color: #1F212A; }
.agt-skill__desc { font-size: 11.5px; color: #8A909C; line-height: 1.45; }
.agt-skill--write .agt-skill__name { color: #8A5A0B; }
.agt-skill--write.is-on { background: #FEFAF1; border-color: #F0DFB8; }
/* Must come AFTER the generic checked rule above — same specificity, so source order is
   what keeps a ticked write skill amber instead of navy. The tick itself is inherited. */
.agt-skill--write input:checked + .agt-toggle__box { background: #8A5A0B; border-color: #8A5A0B; }

/* Visible, but plainly not on offer yet — no hover, no pointer, muted. */
.agt-skill.is-soon { cursor: default; opacity: 0.6; }
.agt-skill.is-soon:hover { background: transparent; }
.agt-skill.is-soon .agt-toggle__box { background: #F4F5FA; border-color: #DDE0EA; }
.agt-soon {
    display: inline-block; margin-left: 6px; padding: 1px 6px;
    background: #F1F2F6; color: #8A909C;
    border-radius: 999px;
    font-size: 9.5px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase;
    vertical-align: 1px;
}

.agt-divider {
    display: flex; align-items: center; gap: 10px;
    margin: 18px 0 8px;
    font-size: 10.5px; font-weight: 650; letter-spacing: 0.08em;
    text-transform: uppercase; color: #8A5A0B;
}
.agt-divider::after { content: ""; flex: 1; height: 1px; background: #F0DFB8; }

.agt-callout {
    margin-top: 14px; padding: 11px 14px;
    background: #FEFAF1; border: 1px solid #F0DFB8; border-radius: 7px;
    font-size: 12px; color: #7A4F09; line-height: 1.55;
}
.agt-callout--top { margin: 0 0 18px; font-size: 12.5px; }
.agt-callout--top strong { display: block; margin-bottom: 2px; font-weight: 650; }
.agt-model { font-size: 11.5px; color: #8A909C; margin: -8px 0 18px; }

/* ── list ──────────────────────────────────────────────── */
.agt-list-head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; flex-wrap: wrap; margin-bottom: 12px;
}
.agt-section-title {
    font-size: 15px; font-weight: 650; color: #1F212A; margin: 0;
    display: flex; align-items: center; gap: 8px;
}
.agt-count {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 19px; height: 19px; padding: 0 6px;
    background: #EEF0FE; color: #6473E8;
    border-radius: 10px; font-size: 11px; font-weight: 650;
}

.agt-empty {
    padding: 38px 24px;
    text-align: center;
    background: #FBFCFF;
    border: 1px dashed #DADDE8;
    border-radius: 10px;
}
.agt-empty__icon { display: block; font-size: 30px; margin-bottom: 10px; }
.agt-empty__title { font-size: 14px; font-weight: 600; color: #1F212A; margin: 0 0 4px; }
.agt-empty__body { font-size: 12.5px; color: #8A909C; margin: 0; }

/* The wrapper owns the gap so the test panel can sit flush under its own row. */
.agt-item { margin-bottom: 8px; }

.agt-row {
    display: flex; align-items: flex-start; gap: 13px;
    padding: 15px 16px;
    background: #fff;
    border: 1px solid #E7E9F3;
    border-radius: 9px;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.agt-row.is-testing {
    border-color: #C8CEF5;
    border-bottom-color: #E7E9F3;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
}
.agt-row:hover { border-color: #CFD4E6; box-shadow: 0 2px 8px rgba(23, 24, 36, 0.05); }
.agt-row.is-off { background: #FCFCFD; }
.agt-row.is-off .agt-row__avatar { filter: grayscale(1); opacity: 0.65; }

.agt-row__avatar {
    display: inline-flex; align-items: center; justify-content: center;
    width: 36px; height: 36px; flex: none;
    font-size: 17px; border-radius: 9px;
}
.agt-row__body { flex: 1 1 auto; min-width: 0; }
.agt-row__name {
    font-size: 14px; font-weight: 650; color: #1F212A;
    display: flex; align-items: center; flex-wrap: wrap; gap: 7px;
}
.agt-row__desc { font-size: 12.5px; color: #6B7280; margin: 3px 0 0; }
.agt-row__meta { font-size: 11.5px; color: #8A909C; margin: 4px 0 0; }
.agt-row__actions { display: flex; align-items: center; gap: 13px; flex: 0 0 auto; white-space: nowrap; }

.agt-pill {
    display: inline-flex; align-items: center;
    padding: 2px 8px; border-radius: 999px;
    font-size: 10.5px; font-weight: 650; letter-spacing: 0.02em;
    background: #F1F2F6; color: #6B7280;
}
.agt-pill.is-on { background: #E4F5EA; color: #1B7F3B; }
.agt-pill.is-off { background: #F1F2F6; color: #8A909C; }
.agt-pill.is-scope { background: #EEF0FE; color: #6473E8; }
.agt-pill.is-write { background: #FEF4E2; color: #8A5A0B; }
.agt-pill.is-bad { background: #FDECEC; color: #C62828; }

/* ── test run ──────────────────────────────────────────── */
.agt-test {
    padding: 14px 16px;
    background: #F8F9FE;
    border: 1px solid #C8CEF5;
    border-top: 0;
    border-radius: 0 0 9px 9px;
}
.agt-test__note { font-size: 11.5px; color: #6473E8; margin: 0 0 11px; line-height: 1.5; }
.agt-test__controls { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.agt-test__pick { flex: 1 1 260px; min-width: 0; }
.agt-test__pick:disabled { background: #F4F5FA; color: #8A909C; cursor: default; }

.agt-test__out {
    margin-top: 12px;
    padding: 12px 14px;
    background: #fff;
    border: 1px solid #E3E6F5;
    border-left: 3px solid #6473E8;
    border-radius: 7px;
}
.agt-test__out.is-bad { border-left-color: #C62828; background: #FFFAFA; border-color: #F3D4D4; }
.agt-test__out-label {
    display: block; margin-bottom: 6px;
    font-size: 10.5px; font-weight: 650; letter-spacing: 0.07em; text-transform: uppercase;
    color: #6473E8;
}
.agt-test__out.is-bad .agt-test__out-label { color: #C62828; }
/* The model's reply is its own words — preserve the line breaks it chose, and let
   a long one wrap rather than stretching the page. */
.agt-test__out-body {
    margin: 0; font-size: 13px; color: #1F212A; line-height: 1.6;
    white-space: pre-wrap; overflow-wrap: break-word;
}
.agt-test__out-meta { margin: 8px 0 0; font-size: 11px; color: #8A909C; font-variant-numeric: tabular-nums; }

/* ── activity ──────────────────────────────────────────── */
/* A tab panel now, so no separator or top margin of its own. */
.agt-activity { margin-top: 0; padding-top: 0; border-top: 0; }
.agt-desc--sm { font-size: 12px; margin: -4px 0 14px; }
.agt-desc--flush { margin: 0; }

.agt-activity__tools { display: flex; align-items: center; gap: 12px; }
.agt-activity__filter { width: auto; min-width: 170px; padding: 6px 10px; font-size: 12.5px; }

/* Per-agent spend for the month. The whole row is the filter control, so the
   number you are looking at and the way to drill into it are the same thing. */
.agt-spend {
    margin: 0 0 16px;
    border: 1px solid #E7E9F3;
    border-radius: 8px;
    overflow: hidden;
}
.agt-spend__row {
    display: flex; align-items: center; gap: 14px;
    padding: 9px 13px;
    border-bottom: 1px solid #F4F5F9;
    cursor: pointer;
    transition: background 0.12s ease;
}
.agt-spend__row:last-child { border-bottom: 0; }
.agt-spend__row:hover { background: #F8F9FE; }
.agt-spend__row.is-picked { background: #EEF0FE; }
.agt-spend__row:focus-visible { outline: 2px solid #2F3990; outline-offset: -2px; }
.agt-spend__name { flex: 1 1 auto; min-width: 0; font-size: 12.5px; font-weight: 600; color: #1F212A; overflow-wrap: break-word; }
.agt-spend__n { flex: none; font-size: 11.5px; color: #6B7280; font-variant-numeric: tabular-nums; }
.agt-spend__n--bad { color: #C62828; }

/* ── activity table ────────────────────────────────────── */
/* Its own scroll container: a long agent name or error must never make the whole
   settings page scroll sideways. */
.agt-table-wrap { overflow-x: auto; border: 1px solid #E7E9F3; border-radius: 8px; }
/* min-width so the columns keep their proportions and the wrapper scrolls, rather
   than the text crushing when the panel is narrow. */
.agt-table { width: 100%; min-width: 680px; border-collapse: collapse; font-size: 12.5px; }

/* Column widths. Result is the only one left elastic — it holds the "nothing to add"
   note and any error message, so it should absorb whatever room is spare. */
.agt-col--agent { width: 26%; }
.agt-col--trigger { width: 120px; }
.agt-col--result { width: auto; }
.agt-col--tokens { width: 92px; }
.agt-col--when { width: 96px; }

.agt-table th {
    text-align: left; white-space: nowrap;
    padding: 9px 13px;
    background: #FBFCFF;
    border-bottom: 1px solid #E7E9F3;
    font-size: 10.5px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase;
    color: #8A909C;
}
.agt-table td { padding: 10px 13px; border-bottom: 1px solid #F4F5F9; color: #2A2C39; vertical-align: top; }
.agt-table tbody tr:last-child td { border-bottom: 0; }
.agt-table tbody tr:hover { background: #FBFCFF; }

/* `.agt-table th` is class+element, so it outranked a bare `.agt-table__num` and the
   Tokens HEADING stayed left-aligned while its numbers sat right — the column read as
   two different columns. Qualifying both sides settles it in the right direction. */
.agt-table th.agt-table__num,
.agt-table td.agt-table__num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.agt-table td.agt-table__when { white-space: nowrap; color: #8A909C; }

.agt-run__dot {
    display: inline-block;
    flex: none; width: 7px; height: 7px; margin-right: 6px;
    background: #C7CBDA; border-radius: 50%;
    vertical-align: 1px;
}
.agt-run__dot.is-done { background: #1B7F3B; }
.agt-run__dot.is-failed { background: #C62828; }
.agt-run__dot.is-running { background: #6473E8; }
.agt-run__err { display: block; font-size: 11.5px; color: #C62828; margin: 4px 0 0; line-height: 1.5; overflow-wrap: break-word; }
/* Not an error — a successful run that had nothing to say. Muted, not red. */
.agt-run__note { display: block; font-size: 11.5px; color: #8A909C; margin: 4px 0 0; line-height: 1.5; font-style: italic; }

/* ── pager ─────────────────────────────────────────────── */
/* Right-aligned, under the end of the table — that is where the eye lands after
   reading a row, and it matches the right-aligned Tokens column above it. */
.agt-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 14px; }
.agt-pager__at { font-size: 12px; color: #8A909C; font-variant-numeric: tabular-nums; }
.agt-pager .agt-btn:disabled { opacity: 0.45; cursor: default; }
.agt-pager .agt-btn:disabled:hover { background: #fff; border-color: #D6D9E4; }

.agt-link {
    padding: 0; font-family: inherit; font-size: 12.5px; font-weight: 550;
    color: #6473E8; background: none; border: 0; cursor: pointer;
}
.agt-link:hover { text-decoration: underline; }
.agt-link--danger { color: #C62828; }
.agt-link:focus-visible { outline: 2px solid #2F3990; outline-offset: 2px; border-radius: 3px; }

/* Enable / pause switch */
.agt-switch { position: relative; display: inline-block; width: 34px; height: 19px; flex: none; margin: 0; }
.agt-switch input { opacity: 0; width: 0; height: 0; }
.agt-slider {
    position: absolute; inset: 0;
    background: #D6D9E4; border-radius: 19px;
    transition: background 0.15s ease; cursor: pointer;
}
.agt-slider::before {
    content: ""; position: absolute;
    height: 15px; width: 15px; left: 2px; top: 2px;
    background: #fff; border-radius: 50%;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
    transition: transform 0.15s ease;
}
.agt-switch input:checked + .agt-slider { background: #2F3990; }
.agt-switch input:checked + .agt-slider::before { transform: translateX(15px); }
.agt-switch input:focus-visible + .agt-slider { outline: 2px solid #2F3990; outline-offset: 2px; }

.agt-footnote {
    font-size: 11.5px; color: #8A909C; line-height: 1.55;
    margin: 18px 0 0; padding-top: 14px; border-top: 1px solid #EDEFF5;
}

@media (max-width: 640px) {
    .agt-row { flex-wrap: wrap; }
    .agt-row__actions { width: 100%; justify-content: flex-end; }
    .agt-usage__stats { gap: 22px; }
    .agt-btn--danger { margin-left: 0; }
    .agt-test__controls { flex-direction: column; align-items: stretch; }
    .agt-test__pick { flex: 1 1 auto; }
    /* The filter is the wider control, so it takes the row and Refresh follows. */
    .agt-activity__tools { flex-wrap: wrap; width: 100%; }
    .agt-activity__filter { flex: 1 1 100%; min-width: 0; }
    /* Numbers stay on one line; the name is what gives way. */
    .agt-spend__row { flex-wrap: wrap; gap: 4px 12px; }
    .agt-spend__name { flex: 1 1 100%; }
    /* Centred rather than hugging the edge, where a thumb would sit on it. */
    .agt-pager { justify-content: center; }
}
@media (prefers-reduced-motion: reduce) {
    .agt-btn, .agt-input, .agt-skill, .agt-row, .agt-slider, .agt-slider::before, .agt-toggle__box, .agt-toggle__box::after {
        transition: none;
    }
}
</style>
