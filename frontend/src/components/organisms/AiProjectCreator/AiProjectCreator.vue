<template>
    <Sidebar
        v-if="visible"
        :visible="visible"
        :close-on-back-drop="!isBusy"
        :width="clientWidth <= 768 ? '100%' : '780px'"
        :top="clientWidth <= 767 ? '0px' : '46px'"
        @update:visible="onSidebarVisibleChange">
        <template #head-left>
            <span class="aipg-head-title">
                <span class="aipg-spark" aria-hidden="true">✨</span>
                Create project with AI
            </span>
        </template>
        <template #head-right>
            <button
                v-if="step !== 'executing'"
                class="btn outline-primary d-flex align-items-center justify-content-center aipg-cancel-btn"
                :class="{ 'cursor-pointer': !isBusy, 'cursor-default pointer-event-none': isBusy }"
                :disabled="isBusy"
                @click="onClose()">{{ $t('Projects.cancel') }}</button>
        </template>
        <template #body>
            <div class="aipg-wrapper">
                <!-- Stepper -->
                <ol class="aipg-stepper" role="list">
                    <li class="aipg-step" :class="stepClass('input')">
                        <span class="aipg-step-dot">{{ stepDoneDot('input', '1') }}</span>
                        <span class="aipg-step-label">Describe</span>
                    </li>
                    <li class="aipg-step-line" :class="{ 'done': isStepDone('input') }"></li>
                    <li class="aipg-step" :class="stepClass('clarify')">
                        <span class="aipg-step-dot">{{ stepDoneDot('clarify', '2') }}</span>
                        <span class="aipg-step-label">Clarify</span>
                    </li>
                    <li class="aipg-step-line" :class="{ 'done': isStepDone('clarify') }"></li>
                    <li class="aipg-step" :class="stepClass('preview')">
                        <span class="aipg-step-dot">{{ stepDoneDot('preview', '3') }}</span>
                        <span class="aipg-step-label">Review plan</span>
                    </li>
                    <li class="aipg-step-line" :class="{ 'done': isStepDone('preview') }"></li>
                    <li class="aipg-step" :class="stepClass('executing', 'done')">
                        <span class="aipg-step-dot">{{ step === 'done' ? '✓' : '4' }}</span>
                        <span class="aipg-step-label">Create</span>
                    </li>
                </ol>

                <!-- STEP 1: INPUT -->
                <section v-if="step === 'input'" class="aipg-section">
                    <div class="aipg-card">
                        <label class="aipg-field-label">What is the project about?</label>
                        <textarea
                            v-model="description"
                            class="aipg-textarea"
                            rows="7"
                            :placeholder="placeholderText"
                            :disabled="loading"></textarea>
                        <div class="aipg-helper-row">
                            <span class="aipg-helper" :class="{ 'aipg-helper-ok': description.length >= 20 }">
                                {{ description.length }} / 20 minimum characters
                            </span>
                        </div>
                    </div>

                    <div class="aipg-card">
                        <label class="aipg-field-label">Workspace</label>
                        <p class="aipg-helper">Choose who can see this project once it's created.</p>
                        <div class="aipg-privacy-row">
                            <button
                                type="button"
                                class="aipg-privacy-option"
                                :class="{ 'aipg-privacy-option-active': !isPrivateSpace }"
                                :disabled="loading"
                                @click="isPrivateSpace = false">
                                <span class="aipg-privacy-icon" aria-hidden="true">🌐</span>
                                <span class="aipg-privacy-text">
                                    <strong>Public</strong>
                                    <span class="aipg-privacy-sub">Everyone in the workspace can view</span>
                                </span>
                            </button>
                            <button
                                type="button"
                                class="aipg-privacy-option"
                                :class="{ 'aipg-privacy-option-active': isPrivateSpace }"
                                :disabled="loading"
                                @click="isPrivateSpace = true">
                                <span class="aipg-privacy-icon" aria-hidden="true">🔒</span>
                                <span class="aipg-privacy-text">
                                    <strong>Private</strong>
                                    <span class="aipg-privacy-sub">Only you and invited members</span>
                                </span>
                            </button>
                        </div>
                    </div>

                    <div class="aipg-card">
                        <label class="aipg-field-label">{{ $t('ProjectDetails.skills') }} <span class="aipg-muted">{{ $t('AI.ai_optional') }}</span></label>
                        <p class="aipg-helper">{{ $t('AI.ai_skills_hint') }}</p>
                        <div class="aipg-skills-select">
                            <SkillsSelect v-model="skills" :bordered="true" :showAll="true"/>
                        </div>
                    </div>

                    <div class="aipg-card">
                        <label class="aipg-field-label">{{ $t('ProjectDetails.source') }} <span class="aipg-required">*</span></label>
                        <div class="aipg-skills-select">
                            <ProjectSourceSelect v-model="source"/>
                        </div>

                        <label class="aipg-field-label aipg-field-label-stacked">
                            {{ $t('ProjectDetails.proposal_id') }}
                            <span class="aipg-required" v-if="source === 'upwork'">*</span>
                            <span class="aipg-muted" v-else>{{ $t('AI.ai_optional') }}</span>
                        </label>
                        <p class="aipg-helper">{{ source === 'upwork' ? $t('Projects.proposal_id_format_hint') : $t('AI.ai_proposal_id_hint') }}</p>
                        <input
                            v-model.trim="proposalId"
                            class="aipg-input"
                            type="text"
                            maxlength="100"
                            :placeholder="$t('PlaceHolder.Enter_Proposal_Id')"
                            :disabled="loading"/>
                    </div>

                    <div class="aipg-card">
                        <label class="aipg-field-label">Attach a brief <span class="aipg-muted">— optional</span></label>
                        <p class="aipg-helper">PDF, DOCX, TXT, or MD — up to 10 MB.</p>
                        <label class="aipg-file-drop" :class="{ 'is-disabled': loading || briefUploading }">
                            <input ref="fileInput" type="file" accept=".pdf,.docx,.txt,.md" @change="onFileChosen" :disabled="loading || briefUploading"/>
                            <span v-if="briefUploading" class="aipg-file-drop-inner">
                                <span class="aipg-spinner aipg-spinner-sm" aria-hidden="true"></span>
                                Reading file…
                            </span>
                            <span v-else-if="briefId" class="aipg-file-drop-inner aipg-file-drop-ok">
                                <span class="aipg-tick" aria-hidden="true">✓</span>
                                {{ briefFile?.name }}
                                <button class="aipg-btn-link" type="button" :disabled="loading" @click.prevent="clearBrief">Remove</button>
                            </span>
                            <span v-else class="aipg-file-drop-inner aipg-muted">
                                <span class="aipg-upload-icon" aria-hidden="true">↑</span>
                                Click to choose a file
                            </span>
                        </label>
                    </div>

                    <transition name="aipg-fade">
                        <div v-if="error" class="aipg-alert aipg-alert-danger">
                            <div>{{ error }}</div>
                            <p class="aipg-alert-hint">Click <strong>Generate plan</strong> again — the AI will retry from your description.</p>
                        </div>
                    </transition>

                    <!-- AI working status — visible while any LLM call is in flight -->
                    <transition name="aipg-fade">
                        <div v-if="clarifyLoading || loading" class="aipg-status-panel" role="status" aria-live="polite">
                            <span class="aipg-spinner aipg-status-spinner" aria-hidden="true"></span>
                            <div class="aipg-status-panel-text">
                                <p class="aipg-status-panel-title">
                                    {{ clarifyLoading ? 'Analyzing your brief…' : 'Generating project plan…' }}
                                </p>
                                <p class="aipg-status-panel-sub">
                                    {{ clarifyLoading
                                        ? 'The AI is reading your requirements. This takes a moment.'
                                        : 'Building your sprints and tasks — usually 15–30 seconds. Please wait.' }}
                                </p>
                            </div>
                        </div>
                    </transition>

                    <div v-if="hasGeneratedPlan" class="aipg-actions aipg-actions-split">
                        <button
                            class="aipg-btn aipg-btn-ghost"
                            :disabled="!canGenerate || loading || briefUploading || clarifyLoading"
                            @click="onGeneratePlan">
                            <span v-if="loading || clarifyLoading" class="aipg-spinner aipg-spinner-sm" aria-hidden="true"></span>
                            {{ clarifyLoading ? 'Analyzing brief…' : (loading ? 'Generating plan…' : 'Re-Generate Plan') }}
                        </button>
                        <button
                            class="aipg-btn aipg-btn-primary"
                            :disabled="loading || briefUploading || clarifyLoading"
                            @click="onNextWithExistingPlan">
                            Next →
                        </button>
                    </div>
                    <div v-else-if="hasGeneratedQuestions" class="aipg-actions aipg-actions-split">
                        <!--
                            User came back to Step 1 after generating questions
                            but before generating a plan. Offer a cheap "Next →"
                            that reuses the cached questions (zero LLM cost),
                            plus a "Re-Generate Questions" escape if they want a
                            fresh set after editing the brief.
                        -->
                        <button
                            class="aipg-btn aipg-btn-ghost"
                            :disabled="!canGenerate || loading || briefUploading || clarifyLoading"
                            @click="onRegenerateQuestions">
                            <span v-if="clarifyLoading || loading" class="aipg-spinner aipg-spinner-sm" aria-hidden="true"></span>
                            {{ clarifyLoading ? 'Analyzing brief…' : (loading ? 'Generating plan…' : 'Re-Generate Questions') }}
                        </button>
                        <button
                            class="aipg-btn aipg-btn-primary"
                            :disabled="loading || briefUploading || clarifyLoading"
                            @click="onNextWithExistingQuestions">
                            Next →
                        </button>
                    </div>
                    <div v-else class="aipg-actions">
                        <button
                            class="aipg-btn aipg-btn-primary"
                            :disabled="!canGenerate || loading || briefUploading || clarifyLoading"
                            @click="onGeneratePlan">
                            <span v-if="loading || clarifyLoading" class="aipg-spinner aipg-spinner-sm" aria-hidden="true"></span>
                            {{ clarifyLoading ? 'Analyzing brief…' : (loading ? 'Generating plan…' : (error ? 'Try again' : 'Generate plan')) }}
                        </button>
                    </div>
                </section>

                <!-- STEP 2: CLARIFY -->
                <section v-else-if="step === 'clarify'" class="aipg-section">
                    <!-- Plan-generation status — shows while LLM builds the plan
                         after the user submits their answers. ClarifyStep dims
                         itself (opacity + pointer-events) but this panel makes
                         the wait state unmissable. -->
                    <transition name="aipg-fade">
                        <div v-if="loading" class="aipg-status-panel" role="status" aria-live="polite">
                            <span class="aipg-spinner aipg-status-spinner" aria-hidden="true"></span>
                            <div class="aipg-status-panel-text">
                                <p class="aipg-status-panel-title">Generating project plan…</p>
                                <p class="aipg-status-panel-sub">Building your sprints and tasks — usually 15–30 seconds. Please wait.</p>
                            </div>
                        </div>
                    </transition>
                    <ClarifyStep
                        :loading="clarifyLoading"
                        :generating="loading"
                        :understanding="clarifyUnderstanding"
                        :questions="clarifyQuestions"
                        :error-message="clarifyError"
                        @submit="onClarifySubmit"
                        @back="onClarifyBack"
                        @retry="onClarifyRetry"
                        @skip-all="onClarifySkipAll"
                    />
                </section>

                <!-- STEP 3: PREVIEW -->
                <section v-else-if="step === 'preview'" class="aipg-section">
                    <div class="aipg-plan-header">
                        <div class="aipg-plan-head-row">
                            <div
                                class="aipg-icon-pill"
                                :style="{ backgroundColor: plan.project.projectIcon.backgroundColor }">
                                {{ plan.project.projectIcon.emoji || '🚀' }}
                            </div>
                            <input
                                v-model="editableProjectName"
                                class="aipg-input-plain aipg-project-name"
                                maxlength="80"
                                :disabled="loading"/>
                            <code class="aipg-code-pill">{{ plan.project.ProjectCode }}</code>
                            <span class="aipg-ml-auto aipg-helper">
                                {{ totals.sprints }} sprints · {{ totals.tasks }} tasks
                                <!-- Cost is omitted, not zeroed, when the model
                                     has no price on file — a wrong number is
                                     worse than no number. -->
                                <template v-if="runUsage">
                                    ·
                                    <span class="aipg-usage" :title="usageTooltip">
                                        {{ formatTokens(runUsage.totalTokens) }} tokens<template
                                            v-if="runUsage.costUsd !== null"> · {{ formatCost(runUsage.costUsd) }}</template>
                                    </span>
                                </template>
                            </span>
                        </div>
                        <p class="aipg-plan-description">{{ plan.project.description }}</p>
                        <div class="aipg-plan-skills">
                            <label class="aipg-field-label-sm">{{ $t('ProjectDetails.skills') }}</label>
                            <SkillsSelect v-model="skills" :bordered="true" :showAll="true"/>
                        </div>
                    </div>

                    <div class="aipg-folder-list">
                        <details
                            v-for="(sprint, si) in plan.sprints"
                            :key="'s-'+si"
                            class="aipg-folder"
                            :open="si === 0">
                            <summary class="aipg-folder-summary">
                                <span class="aipg-chevron" aria-hidden="true">›</span>
                                <input
                                    v-model="sprint.sprintName"
                                    class="aipg-input-plain aipg-folder-name"
                                    maxlength="80"
                                    :disabled="loading"
                                    @click.stop/>
                                <span class="aipg-pill aipg-ml-auto">{{ sprint.tasks.length }} tasks</span>
                            </summary>
                            <ul class="aipg-task-list">
                                <li v-for="(task, ti) in sprint.tasks" :key="'t-'+si+'-'+ti" class="aipg-task">
                                    <input
                                        v-model="task.TaskName"
                                        class="aipg-input-plain aipg-task-name"
                                        maxlength="200"
                                        :disabled="loading"/>
                                    <details class="aipg-task-desc">
                                        <summary class="aipg-task-desc-trigger">
                                            <span class="aipg-chevron aipg-chevron-sm" aria-hidden="true">›</span>
                                            Description
                                        </summary>
                                        <pre class="aipg-task-desc-body">{{ renderTaskDescription(task) }}</pre>
                                    </details>
                                </li>
                            </ul>
                        </details>
                    </div>

                    <transition name="aipg-fade">
                        <div v-if="error" class="aipg-alert aipg-alert-danger">{{ error }}</div>
                    </transition>

                    <div class="aipg-actions aipg-actions-split">
                        <button class="aipg-btn aipg-btn-ghost" @click="step = 'input'; error = ''" :disabled="loading">
                            ← Back
                        </button>
                        <button class="aipg-btn aipg-btn-primary" :disabled="loading" @click="onApprovePlan">
                            <span v-if="loading" class="aipg-spinner aipg-spinner-sm" aria-hidden="true"></span>
                            {{ loading ? 'Starting…' : '✓ Create everything' }}
                        </button>
                    </div>
                </section>

                <!-- STEP 3: EXECUTING / DONE -->
                <section v-else-if="step === 'executing' || step === 'done'" class="aipg-section">
                    <div class="aipg-exec-head">
                        <span v-if="step === 'executing'" class="aipg-spinner" aria-hidden="true"></span>
                        <span v-else class="aipg-success-tick" aria-hidden="true">✓</span>
                        <h4 class="aipg-exec-title">{{ step === 'done' ? 'All done!' : 'Building your project…' }}</h4>
                    </div>
                    <div class="aipg-progress-list">
                        <div class="aipg-progress-row" :class="rowClass('project')">
                            <span class="aipg-progress-icon"><span v-html="stepIcon('project')" /></span>
                            <span class="aipg-progress-label">Project</span>
                            <span class="aipg-progress-status">{{ stepStatusLabel('project') }}</span>
                        </div>
                        <div class="aipg-progress-row" :class="rowClass('sprint')">
                            <span class="aipg-progress-icon"><span v-html="stepIcon('sprint')" /></span>
                            <span class="aipg-progress-label">Sprints</span>
                            <span class="aipg-progress-status">{{ progress.sprintsDone }} / {{ progress.totalSprints || '…' }}</span>
                        </div>
                        <div class="aipg-progress-row" :class="rowClass('tasks')">
                            <span class="aipg-progress-icon"><span v-html="stepIcon('tasks')" /></span>
                            <span class="aipg-progress-label">Tasks</span>
                            <span class="aipg-progress-status">{{ progress.tasksDone }} / {{ progress.totalTasks || '…' }}</span>
                        </div>
                    </div>

                    <p v-if="progress.lastEvent" class="aipg-helper aipg-helper-center">
                        {{ progress.lastEvent }}
                    </p>

                    <div v-if="step === 'done'" class="aipg-actions">
                        <button class="aipg-btn aipg-btn-primary" @click="onOpenProject">
                            Open project →
                        </button>
                    </div>
                </section>

                <section v-else-if="step === 'error'" class="aipg-section">
                    <div class="aipg-exec-head">
                        <span class="aipg-error-tick" aria-hidden="true">!</span>
                        <h4 class="aipg-exec-title">Something went wrong</h4>
                    </div>
                    <div class="aipg-alert aipg-alert-danger">{{ error || 'Unknown error' }}</div>
                    <p v-if="rolledBack" class="aipg-helper">All partial creates have been rolled back.</p>
                    <div class="aipg-actions aipg-actions-split">
                        <button class="aipg-btn aipg-btn-ghost" @click="onClose">Close</button>
                        <button class="aipg-btn aipg-btn-primary" @click="onRetry">Back to plan</button>
                    </div>
                </section>
            </div>
        </template>
    </Sidebar>
</template>

<script>
import { ref, reactive, computed, onBeforeUnmount, inject, defineComponent } from 'vue';
import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
import ClarifyStep from './clarify/ClarifyStep.vue';
import { useAiProjectGenerator } from '@/composable/aiProjectGenerator';
import { useStore } from 'vuex';
import SkillsSelect from '@/components/molecules/SkillsSelect/SkillsSelect.vue';
import ProjectSourceSelect from '@/components/molecules/ProjectSourceSelect/ProjectSourceSelect.vue';
import { PROJECT_SOURCES, checkProposalId } from '@/utils/projectSource';
import { useI18n } from 'vue-i18n';

export default defineComponent({
    name: 'AiProjectCreator',
    components: { Sidebar, ClarifyStep, SkillsSelect, ProjectSourceSelect },
    props: {
        visible: { type: Boolean, default: false },
    },
    emits: ['close', 'created'],
    setup(props, { emit }) {
        const clientWidth = inject('$clientWidth') || ref(window.innerWidth);
        const api = useAiProjectGenerator();
        const store = useStore();
        const { t } = useI18n();

        const step = ref('input'); // input | clarify | preview | executing | done | error
        const loading = ref(false);
        const briefUploading = ref(false);
        const error = ref('');
        const rolledBack = ref(false);

        // ── Clarify step state ───────────────────────────────────────────
        // The Clarify step is OPTIONAL. If the brief is already detailed
        // enough the LLM returns zero questions and we skip it. If the
        // /clarify call fails we also skip it — the user can still finish
        // the flow with the existing plan generation.
        const clarifyLoading = ref(false);   // true while we're fetching questions
        const clarifyQuestions = ref([]);    // [{id, category, question, type, options, recommended, ...}]
        const clarifyUnderstanding = ref('');// short "here's what I heard" line from the LLM
        const clarifyError = ref('');        // error message inside the clarify step (recoverable)
        // The answers/skips the user submitted from the Clarify step,
        // sent verbatim into /plan as the `clarifications` array.
        const clarifications = ref(null);

        // True when ANY in-flight operation owns the modal — brief upload,
        // clarify LLM call, plan LLM call, or the orchestrator's execute
        // job. The backdrop-close + X-icon both gate on this so a stray
        // outside click cannot abort an in-flight LLM/orchestrator run.
        const isBusy = computed(() =>
            step.value === 'executing'
            || loading.value
            || clarifyLoading.value
            || briefUploading.value,
        );

        const description = ref('');
        // Mirrors the manual flow's workspace step: 'public' → private=false.
        // We force this onto the plan server-side so the user's choice always
        // wins over whatever the LLM picked.
        const isPrivateSpace = ref(false);
        // Sent straight to /execute — kept out of the plan so the LLM can't invent one.
        const proposalId = ref('');
        const source = ref('');
        // Step-1 picks, merged with the model's suggestions once the plan lands.
        const skills = ref([]);
        const briefFile = ref(null);
        const briefId = ref(null);
        const briefStats = reactive({ tokenEstimate: 0, charCount: 0, truncated: false });

        const plan = ref(null);
        const planId = ref(null);
        const editableProjectName = computed({
            get: () => (plan.value ? plan.value.project.ProjectName : ''),
            set: (v) => { if (plan.value) plan.value.project.ProjectName = String(v || '').slice(0, 80); },
        });

        const jobId = ref(null);
        const unsubscribeProgress = ref(null);
        const progress = reactive({
            project: 'pending',
            sprintsDone: 0,
            totalSprints: 0,
            sprintState: 'pending',
            tasksDone: 0,
            totalTasks: 0,
            tasksState: 'pending',
            lastEvent: '',
        });
        const createdProjectId = ref(null);

        const placeholderText = 'e.g. "A 3-month SaaS launch for a 5-person team building an invoicing tool with Stripe billing. Kanban workflow. GitHub + Slack integrations. MVP in 6 weeks; full launch in 12."';

        const canGenerate = computed(() => description.value.trim().length >= 20);

        // True once a plan has been produced and is still held in memory.
        // Drives the dual-button layout on Step 1 (Next + Re-Generate)
        // when the user comes back from the preview/review screen.
        // We check `sprints` length too so a stale `{}` or partial object
        // from a failed run never trips this flag.
        const hasGeneratedPlan = computed(() => {
            const p = plan.value;
            return !!(p && p.project && Array.isArray(p.sprints) && p.sprints.length > 0);
        });

        // Navigate to the review step using the in-memory plan as-is —
        // no LLM call, no token spend. Used by the "Next" button on
        // Step 1 when the user returned from the preview screen.
        function onNextWithExistingPlan() {
            if (!hasGeneratedPlan.value) return;
            error.value = '';
            step.value = 'preview';
        }

        // True once a clarify-question batch has been produced and is still
        // held in memory. Drives the dual-button layout on Step 1 when the
        // user came back from the Clarify step without yet generating a plan
        // — they can jump straight back to Clarify (no LLM call) or pay for
        // a fresh question set.
        const hasGeneratedQuestions = computed(() => {
            return Array.isArray(clarifyQuestions.value) && clarifyQuestions.value.length > 0;
        });

        // "Next →" path when questions exist but no plan yet — zero token cost,
        // just hop back into the Clarify step with the cached questions and
        // whatever answers the user had already entered.
        function onNextWithExistingQuestions() {
            if (!hasGeneratedQuestions.value) return;
            error.value = '';
            clarifyError.value = '';
            step.value = 'clarify';
        }

        // "Re-Generate Questions" path — costs one clarify LLM call but no
        // plan call. Wipes the cached questions and re-runs the clarify
        // entry point, which transitions to the Clarify step and shows the
        // skeleton placeholders while we wait. If the LLM decides the brief
        // needs no clarifications (unusual after an edit), the existing
        // fall-through in onGeneratePlan still skips straight to plan.
        function onRegenerateQuestions() {
            clarifications.value = null;
            // Clear so the Clarify step shows its skeleton state, not the
            // stale questions, while the new fetch is in flight.
            clarifyQuestions.value = [];
            clarifyUnderstanding.value = '';
            return onGeneratePlan();
        }

        const totals = computed(() => {
            if (!plan.value || !Array.isArray(plan.value.sprints)) return { sprints: 0, tasks: 0 };
            let t = 0;
            for (const sp of plan.value.sprints) t += (sp.tasks || []).length;
            return { sprints: plan.value.sprints.length, tasks: t };
        });

        // What this run cost. One wizard run can be two LLM calls — the clarify
        // round and the plan itself — so both are collected and added up;
        // reporting only the plan would undercount every run that asked
        // questions first.
        const clarifyUsage = ref(null);
        const planUsage = ref(null);

        const runUsage = computed(() => {
            const parts = [clarifyUsage.value, planUsage.value].filter(Boolean);
            if (!parts.length) return null;
            const totalTokens = parts.reduce((sum, u) => sum + (Number(u.totalTokens) || 0), 0);
            if (!totalTokens) return null;
            // A cost is shown only when EVERY call in the run was priced.
            // Adding a priced call to an unpriced one would render a number
            // that looks like the run total but silently omits part of it.
            const priced = parts.every((u) => u.priced && typeof u.costUsd === 'number');
            return {
                totalTokens,
                inputTokens: parts.reduce((sum, u) => sum + (Number(u.inputTokens) || 0), 0),
                outputTokens: parts.reduce((sum, u) => sum + (Number(u.outputTokens) || 0), 0),
                costUsd: priced ? parts.reduce((sum, u) => sum + u.costUsd, 0) : null,
                model: (planUsage.value && planUsage.value.model) || '',
            };
        });

        // The breakdown lives in a tooltip: the split explains why the cost is
        // what it is (output is priced several times higher than input), but it
        // is detail, not the headline.
        const usageTooltip = computed(() => {
            const u = runUsage.value;
            if (!u) return '';
            const parts = [`${formatTokens(u.inputTokens)} in · ${formatTokens(u.outputTokens)} out`];
            if (u.model) parts.push(u.model);
            if (u.costUsd === null) parts.push('no price on file for this model');
            return parts.join(' — ');
        });

        const formatTokens = (n) => Number(n || 0).toLocaleString();
        // Sub-cent runs are normal, so two decimals would read as "$0.00".
        const formatCost = (n) => (n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);

        // Render Editor.js blocks as readable plain text for the preview
        // `<pre>`. Matches the orchestrator's blocksToText helper so the
        // preview shows the same text that lands in `rawDescription` on
        // save. Block types we know: paragraph, header, list.
        function renderTaskDescription(task) {
            const blocks = (task && Array.isArray(task.descriptionBlocks)) ? task.descriptionBlocks : [];
            const out = [];
            for (const b of blocks) {
                if (!b || !b.data) continue;
                if (b.type === 'paragraph' && typeof b.data.text === 'string') {
                    out.push(b.data.text);
                } else if (b.type === 'header' && typeof b.data.text === 'string') {
                    out.push('');
                    out.push(b.data.text);
                } else if (b.type === 'list' && Array.isArray(b.data.items)) {
                    const bullet = b.data.style === 'ordered' ? null : '• ';
                    b.data.items.forEach((item, idx) => {
                        const prefix = bullet === null ? `${idx + 1}. ` : bullet;
                        out.push(`${prefix}${item}`);
                    });
                }
            }
            return out.join('\n').trim();
        }

        function isStepDone(name) {
            // Order includes the new 'clarify' step between input and preview.
            // Steps not in this list (e.g. 'error') treat the step as not done,
            // matching the existing behavior.
            const order = ['input', 'clarify', 'preview', 'executing', 'done'];
            return order.indexOf(name) < order.indexOf(step.value);
        }

        function stepClass(...names) {
            const isActive = names.includes(step.value);
            const isDoneByOrder = names.every((n) => isStepDone(n));
            return {
                'aipg-step-active': isActive,
                'aipg-step-done': isDoneByOrder && !isActive,
            };
        }

        function stepDoneDot(name, numLabel) {
            return isStepDone(name) ? '✓' : numLabel;
        }

        function rowClass(name) {
            const state = name === 'tasks' ? progress.tasksState : progress[`${name}State`] || progress[name];
            return {
                'aipg-progress-row-active': state === 'active',
                'aipg-progress-row-done': state === 'done',
            };
        }

        function stepIcon(name) {
            const state = name === 'tasks' ? progress.tasksState : progress[`${name}State`] || progress[name];
            if (state === 'done') return '✓';
            if (state === 'active') return '<span class="aipg-spinner aipg-spinner-xs"></span>';
            return '·';
        }

        function stepStatusLabel(name) {
            const state = progress[name] || (name === 'tasks' ? progress.tasksState : progress[`${name}State`]);
            if (state === 'done') return 'Done';
            if (state === 'active') return 'In progress';
            return 'Pending';
        }

        async function onFileChosen(evt) {
            const file = evt.target.files && evt.target.files[0];
            if (!file) return;
            briefFile.value = file;
            briefUploading.value = true;
            error.value = '';
            try {
                const result = await api.uploadBrief(file);
                if (result && result.status) {
                    briefId.value = result.briefId;
                    briefStats.tokenEstimate = result.tokenEstimate;
                    briefStats.charCount = result.charCount;
                    briefStats.truncated = result.truncated;
                } else {
                    error.value = (result && result.statusText) || 'Brief upload failed';
                }
            } catch (e) {
                error.value = friendlyErr(e);
            } finally {
                briefUploading.value = false;
            }
        }

        function clearBrief() {
            briefId.value = null;
            briefFile.value = null;
            briefStats.tokenEstimate = 0;
            briefStats.charCount = 0;
            briefStats.truncated = false;
            const el = document.querySelector('.aipg-file-drop input[type=file]');
            if (el) el.value = '';
        }

        // Entry point from Step 1's "Generate plan" button. Tries to fetch
        // clarifying questions first; if any are returned the user is sent
        // into the Clarify step. If the LLM returns zero questions, or if
        // the clarify call fails for any reason, we skip Q&A and run plan
        // generation directly — the wizard MUST stay functional even if
        // the Q&A feature is broken.
        async function onGeneratePlan() {
            if (!canGenerate.value) return;
            error.value = '';
            clarifyError.value = '';
            clarifications.value = null;
            // Stay on Step 1 during the clarify call — the "Generate plan"
            // button shows "Analyzing brief…" via the clarifyLoading flag.
            // We transition to the Clarify wizard ONLY if the LLM returns
            // questions; if it returns `[]` (or fails) we go straight to
            // plan generation without ever showing the wizard skeleton.
            clarifyLoading.value = true;
            try {
                const res = await api.generateClarifyingQuestions({
                    description: description.value.trim(),
                    briefId: briefId.value,
                });
                if (res && res.usage) clarifyUsage.value = res.usage;
                if (res && res.status && Array.isArray(res.questions) && res.questions.length) {
                    // Questions came back — NOW move into the Clarify step.
                    clarifyQuestions.value = res.questions;
                    clarifyUnderstanding.value = res.understanding || '';
                    clarifyLoading.value = false;
                    step.value = 'clarify';
                    return; // user now answers; submit will call runPlanGeneration
                }
                // Empty array, status:false, or malformed — skip Q&A and
                // go straight to plan generation. User never sees the
                // wizard. clarifyLoading stays true → loading flips to
                // `loading` inside runPlanGeneration, so the button text
                // smoothly transitions from "Analyzing brief…" to
                // "Generating plan…" without a state gap.
                clarifyLoading.value = false;
                await runPlanGeneration(null);
            } catch (e) {
                // Clarify failed — graceful fallback to plan generation.
                // User stays on Step 1; runPlanGeneration handles its own
                // error surfacing via error.value.
                clarifyLoading.value = false;
                await runPlanGeneration(null);
            }
        }

        // The actual plan-generation call. Separated from onGeneratePlan so
        // both the post-clarify submit and the "skip clarify" fallback can
        // share it without duplicating the SSE-wait + error handling.
        async function runPlanGeneration(clarificationsPayload) {
            loading.value = true;
            error.value = '';
            try {
                const result = await api.generatePlan({
                    description: description.value.trim(),
                    briefId: briefId.value,
                    isPrivateSpace: isPrivateSpace.value,
                    clarifications: clarificationsPayload,
                    // Picked in step 1 and, until now, only used when saving the
                    // finished project. The plan has to be built for the chosen
                    // technology, not merely tagged with it afterwards.
                    skills: skills.value,
                });
                if (!result || !result.status) {
                    error.value = (result && result.statusText) || 'Plan generation failed. Please try again.';
                    step.value = 'input'; // back to Step 1 so user can retry
                    return;
                }
                if (!result.plan) {
                    error.value = 'The AI did not return a plan. Please try again.';
                    step.value = 'input';
                    return;
                }
                plan.value = result.plan;
                planId.value = result.planId;
                planUsage.value = result.usage || null;
                mergeSuggestedSkills(result.plan);
                step.value = 'preview';
            } catch (e) {
                error.value = friendlyErr(e);
                step.value = 'input';
            } finally {
                loading.value = false;
            }
        }

        // User's picks first, then the model's — known slugs only, mirroring the
        // server rule so the review step never shows a tick that won't save.
        function mergeSuggestedSkills(generatedPlan) {
            const suggested = generatedPlan && generatedPlan.project && Array.isArray(generatedPlan.project.skills)
                ? generatedPlan.project.skills
                : [];
            if (!suggested.length) return;
            const known = new Set((store.getters['settings/projectSkills'] || [])
                .filter((s) => s.active !== false)
                .map((s) => s.slug));
            const merged = [...skills.value];
            for (const slug of suggested) {
                if (known.has(slug) && !merged.includes(slug) && merged.length < 15) merged.push(slug);
            }
            skills.value = merged;
        }

        // ── Clarify step handlers ────────────────────────────────────────
        // Submitted from the ClarifyStep component with the full
        // clarifications array (one entry per question, including skipped).
        async function onClarifySubmit(clarificationsPayload) {
            clarifications.value = clarificationsPayload;
            await runPlanGeneration(clarificationsPayload);
        }

        // User clicked "← Back" on the Clarify step — return to Step 1 but
        // KEEP the generated questions + answers in memory. Step 1 then
        // shows the dual-button layout ("Re-Generate Questions" / "Next →")
        // so the user can hop back into the Clarify step without paying
        // for another LLM call. We only clear `clarifyError` since that's
        // tied to a transient panel state, not to the questions themselves.
        function onClarifyBack() {
            step.value = 'input';
            clarifyError.value = '';
        }

        // Retry button inside the Clarify step's error panel.
        async function onClarifyRetry() {
            clarifyError.value = '';
            clarifyLoading.value = true;
            try {
                const res = await api.generateClarifyingQuestions({
                    description: description.value.trim(),
                    briefId: briefId.value,
                });
                if (res && res.usage) clarifyUsage.value = res.usage;
                if (res && res.status && Array.isArray(res.questions) && res.questions.length) {
                    clarifyQuestions.value = res.questions;
                    clarifyUnderstanding.value = res.understanding || '';
                } else {
                    // Still empty — just skip and generate.
                    await runPlanGeneration(null);
                }
            } catch (e) {
                clarifyError.value = friendlyErr(e);
            } finally {
                clarifyLoading.value = false;
            }
        }

        // "Skip and generate plan" button inside the Clarify error panel.
        async function onClarifySkipAll() {
            await runPlanGeneration(null);
        }

        function buildEdits() {
            const p = plan.value;
            return {
                project: {
                    ProjectName: p.project.ProjectName,
                    description: p.project.description,
                },
                sprints: (p.sprints || []).map((s) => ({
                    sprintName: s.sprintName,
                    tasks: (s.tasks || []).map((t) => ({ TaskName: t.TaskName })),
                })),
            };
        }

        async function onApprovePlan() {
            if (!plan.value) return;
            // Enforced here rather than before plan generation: the AI doesn't
            // need either value, so blocking step 1 would be friction for nothing.
            if (!PROJECT_SOURCES.includes(source.value)) {
                error.value = t('Projects.source_required');
                step.value = 'input';
                return;
            }
            if (checkProposalId(source.value, proposalId.value) === 'required') {
                error.value = t('Projects.proposal_id_required_upwork');
                step.value = 'input';
                return;
            }
            loading.value = true;
            error.value = '';
            try {
                const result = await api.execute({
                    plan: plan.value,
                    edits: buildEdits(),
                    userName: '',
                    isPrivateSpace: isPrivateSpace.value,
                    proposalId: proposalId.value,
                    source: source.value,
                    skills: skills.value,
                });
                if (!result || !result.status || !result.jobId) {
                    error.value = (result && result.statusText) || 'Execute failed';
                    return;
                }
                jobId.value = result.jobId;
                step.value = 'executing';
                progress.totalSprints = totals.value.sprints;
                progress.totalTasks = totals.value.tasks;
                subscribe();
            } catch (e) {
                error.value = friendlyErr(e);
            } finally {
                loading.value = false;
            }
        }

        function subscribe() {
            if (unsubscribeProgress.value) unsubscribeProgress.value();
            unsubscribeProgress.value = api.subscribeToProgress(jobId.value, (payload) => {
                if (!payload) return;
                if (payload.data) payload = payload.data;
                if (payload.event === 'progress') {
                    progress.lastEvent = `${payload.step}: ${payload.status}${payload.name ? ' · ' + payload.name : ''}`;
                    if (payload.step === 'project') {
                        progress.project = payload.status === 'done' ? 'done' : 'active';
                    } else if (payload.step === 'sprint') {
                        progress.sprintState = payload.status === 'done' ? 'done' : 'active';
                        if (payload.status === 'progress') progress.sprintsDone += 1;
                        if (payload.status === 'done' && typeof payload.completed === 'number') {
                            progress.sprintsDone = payload.completed;
                        }
                        if (typeof payload.total === 'number') progress.totalSprints = payload.total;
                    } else if (payload.step === 'tasks') {
                        progress.sprintState = 'done';
                        progress.tasksState = payload.status === 'done' ? 'done' : 'active';
                        if (typeof payload.completed === 'number') progress.tasksDone = payload.completed;
                        if (typeof payload.total === 'number') progress.totalTasks = payload.total;
                    }
                } else if (payload.event === 'complete') {
                    progress.project = 'done';
                    progress.sprintState = 'done';
                    progress.tasksState = 'done';
                    progress.sprintsDone = (payload.totals && payload.totals.sprints) || progress.sprintsDone;
                    progress.tasksDone = (payload.totals && payload.totals.tasks) || progress.tasksDone;
                    createdProjectId.value = payload.projectId;
                    step.value = 'done';
                    emit('created', { projectId: payload.projectId });
                } else if (payload.event === 'error') {
                    error.value = payload.error || 'Execution failed';
                    rolledBack.value = !!payload.rolledBack;
                    step.value = 'error';
                }
            });
        }

        function onOpenProject() {
            if (createdProjectId.value) emit('created', { projectId: createdProjectId.value });
            onClose();
        }

        function onRetry() {
            step.value = 'preview';
            error.value = '';
            rolledBack.value = false;
        }

        // Defensive guard for the Sidebar's `update:visible` event. The
        // backdrop already honors `:close-on-back-drop="!isBusy"`, but
        // Sidebar may also emit close from ESC key or programmatic paths
        // — refuse all of them while a run is in flight.
        function onSidebarVisibleChange(nextVisible) {
            if (nextVisible) return;     // open events are parent-driven; ignore
            if (isBusy.value) return;    // mid-run: refuse to close
            onClose();
        }

        function onClose() {
            if (step.value === 'executing') return;
            if (unsubscribeProgress.value) {
                unsubscribeProgress.value();
                unsubscribeProgress.value = null;
            }
            step.value = 'input';
            error.value = '';
            description.value = '';
            briefId.value = null;
            briefFile.value = null;
            briefStats.tokenEstimate = 0;
            briefStats.truncated = false;
            briefStats.charCount = 0;
            plan.value = null;
            planId.value = null;
            jobId.value = null;
            createdProjectId.value = null;
            progress.project = 'pending';
            progress.sprintState = 'pending';
            progress.tasksState = 'pending';
            progress.sprintsDone = 0;
            progress.tasksDone = 0;
            progress.totalSprints = 0;
            progress.totalTasks = 0;
            progress.lastEvent = '';
            rolledBack.value = false;
            briefUploading.value = false;
            isPrivateSpace.value = false;
            proposalId.value = '';
            source.value = '';
            skills.value = [];
            clarifyUsage.value = null;
            planUsage.value = null;
            // Reset clarify state too so re-opening the modal is a clean slate.
            clarifyLoading.value = false;
            clarifyQuestions.value = [];
            clarifyUnderstanding.value = '';
            clarifyError.value = '';
            clarifications.value = null;
            emit('close');
        }

        function friendlyErr(e) {
            if (!e) return 'Unknown error';
            if (e.response && e.response.data && e.response.data.statusText) return e.response.data.statusText;
            if (e.message) return e.message;
            try { return String(e); } catch (_e) { return 'Unknown error'; }
        }

        onBeforeUnmount(() => {
            if (unsubscribeProgress.value) unsubscribeProgress.value();
        });

        return {
            clientWidth, step, loading, briefUploading, error, rolledBack,
            description, isPrivateSpace, proposalId, source, skills, briefFile, briefId, briefStats,
            plan, planId, editableProjectName,
            jobId, progress, createdProjectId,
            placeholderText,
            canGenerate, hasGeneratedPlan, hasGeneratedQuestions, totals, isBusy,
            runUsage, usageTooltip, formatTokens, formatCost,
            renderTaskDescription, isStepDone, stepClass, stepDoneDot, rowClass, stepIcon, stepStatusLabel,
            onFileChosen, clearBrief,
            onGeneratePlan, onNextWithExistingPlan,
            onRegenerateQuestions, onNextWithExistingQuestions,
            onApprovePlan, onOpenProject, onRetry, onClose, onSidebarVisibleChange,
            // Clarify step
            clarifyLoading, clarifyQuestions, clarifyUnderstanding, clarifyError,
            onClarifySubmit, onClarifyBack, onClarifyRetry, onClarifySkipAll,
        };
    },
});
</script>

<style scoped>
/* ─────────────────────────────────────────────────────────────────────
   Design tokens
   ───────────────────────────────────────────────────────────────────── */
.aipg-wrapper {
    --aipg-bg: #ffffff;
    --aipg-bg-subtle: #f8fafc;
    --aipg-bg-muted: #f1f5f9;
    --aipg-border: #e5e7eb;
    --aipg-border-strong: #cbd5e1;
    --aipg-text: #0f172a;
    --aipg-text-muted: #64748b;
    --aipg-text-helper: #94a3b8;
    --aipg-primary: #2F3990;
    --aipg-primary-hover: #252D75;
    --aipg-primary-soft: #eef2ff;
    --aipg-success: #15803d;
    --aipg-success-soft: #dcfce7;
    --aipg-danger: #b91c1c;
    --aipg-danger-soft: #fee2e2;
    --aipg-radius-sm: 6px;
    --aipg-radius: 10px;
    --aipg-radius-lg: 14px;
    --aipg-shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.04);
    --aipg-shadow: 0 2px 12px rgba(15, 23, 42, 0.06);

    padding: 20px 22px 28px;
    color: var(--aipg-text);
    background: var(--aipg-bg);
    font-size: 14px;
    line-height: 1.5;
}

/* ─────────────────────────────────────────────────────────────────────
   Sidebar head
   ───────────────────────────────────────────────────────────────────── */
.aipg-head-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--aipg-text, #0f172a);
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.aipg-spark { font-size: 18px; }

/* Mirrors .create-project-cancelbtn, which is scoped to CreateProject. */
.aipg-cancel-btn {
    max-width: 77px;
    min-width: 77px;
}
@media(max-width: 414px) {
    .aipg-cancel-btn { width: 55px; min-width: 55px; font-size: 14px !important; padding: 3px !important; }
}

/* ─────────────────────────────────────────────────────────────────────
   Stepper
   ───────────────────────────────────────────────────────────────────── */
.aipg-stepper {
    list-style: none;
    padding: 0;
    margin: 0 0 24px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.aipg-step {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #94a3b8;
    transition: color 0.2s ease;
}
.aipg-step-dot {
    width: 28px;
    height: 28px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    background: #f1f5f9;
    color: #94a3b8;
    border: 1.5px solid transparent;
    transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}
.aipg-step-label { font-weight: 500; }
.aipg-step-line {
    flex: 1;
    height: 2px;
    background: #e5e7eb;
    border-radius: 2px;
    transition: background 0.2s ease;
}
.aipg-step-line.done { background: #2F3990; }
.aipg-step-active { color: #2F3990; }
.aipg-step-active .aipg-step-dot {
    background: #eef2ff;
    color: #2F3990;
    border-color: #2F3990;
}
.aipg-step-done { color: #15803d; }
.aipg-step-done .aipg-step-dot {
    background: #dcfce7;
    color: #15803d;
}

/* ─────────────────────────────────────────────────────────────────────
   Section + cards
   ───────────────────────────────────────────────────────────────────── */
.aipg-section { display: flex; flex-direction: column; gap: 16px; }

.aipg-card {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    padding: 16px 18px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.aipg-card:focus-within {
    border-color: #c7d2fe;
    box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.08);
}
.aipg-card-accent {
    background: #f5f3ff;
    border-color: #ddd6fe;
}

/* ─────────────────────────────────────────────────────────────────────
   Form bits
   ───────────────────────────────────────────────────────────────────── */
.aipg-field-label {
    display: block;
    font-weight: 600;
    color: #0f172a;
    margin-bottom: 8px;
    font-size: 14px;
}
.aipg-field-label-sm {
    display: block;
    font-size: 12px;
    color: #64748b;
    font-weight: 500;
    margin-bottom: 4px;
}
.aipg-helper {
    color: #94a3b8;
    font-size: 12px;
    margin: 0;
}
.aipg-helper-row { margin-top: 8px; }
.aipg-helper-ok { color: #15803d; }
.aipg-helper-center { text-align: center; }
.aipg-muted { color: #94a3b8; }
.aipg-ml-auto { margin-left: auto; }

.aipg-textarea {
    width: 100%;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 12px 14px;
    font: inherit;
    font-size: 14px;
    color: #0f172a;
    background: #ffffff;
    resize: vertical;
    min-height: 180px;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.aipg-textarea:focus {
    outline: none;
    border-color: #2F3990;
    box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.12);
}
.aipg-textarea:disabled {
    background: #f8fafc;
    color: #94a3b8;
    cursor: not-allowed;
}
.aipg-textarea-sm { min-height: 100px; }

.aipg-input {
    width: 100%;
    margin-top: 10px;   /* same helper-to-control gap as .aipg-file-drop */
    padding: 8px 12px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    font-size: 14px;
    background: #ffffff;
    color: #0f172a;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.aipg-input:focus {
    outline: none;
    border-color: #2F3990;
    box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12);
}
.aipg-input:disabled {
    background: #f8fafc;
    color: #94a3b8;
    cursor: not-allowed;
}
.aipg-range { width: 100%; margin-top: 10px; }

.aipg-privacy-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 10px;
}
.aipg-privacy-option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border: 1.5px solid #e5e7eb;
    border-radius: 10px;
    background: #ffffff;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    font: inherit;
    color: inherit;
}
.aipg-privacy-option:hover:not(:disabled) {
    border-color: #c7d2fe;
    background: #fafbff;
}
.aipg-privacy-option-active {
    border-color: #2F3990;
    background: #eef2ff;
    box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.08);
}
.aipg-privacy-option:disabled { cursor: not-allowed; opacity: 0.6; }
.aipg-privacy-icon {
    font-size: 20px;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: #f8fafc;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.aipg-privacy-option-active .aipg-privacy-icon {
    background: #ffffff;
}
.aipg-privacy-text { display: inline-flex; flex-direction: column; gap: 2px; min-width: 0; }
.aipg-privacy-text strong { font-size: 14px; color: #0f172a; }
.aipg-privacy-sub { font-size: 12px; color: #64748b; }
.aipg-privacy-option-active .aipg-privacy-sub { color: #252D75; }
.aipg-target-count {
    display: inline-block;
    margin-left: 8px;
    padding: 2px 10px;
    background: #eef2ff;
    color: #2F3990;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 700;
}

.aipg-input-plain {
    border: 1px solid transparent;
    background: transparent;
    padding: 4px 6px;
    border-radius: 6px;
    font: inherit;
    color: inherit;
    transition: background 0.15s ease, border-color 0.15s ease;
}
.aipg-input-plain:hover:not(:disabled) {
    background: #f8fafc;
    border-color: #e5e7eb;
}
.aipg-input-plain:focus {
    outline: none;
    background: #ffffff;
    border-color: #2F3990;
    box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12);
}
.aipg-input-plain:disabled { cursor: not-allowed; opacity: 0.7; }

/* ─────────────────────────────────────────────────────────────────────
   Disclosure (advanced hints + task descriptions)
   ───────────────────────────────────────────────────────────────────── */
.aipg-disclosure { padding: 14px 18px; }
.aipg-disclosure-summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 14px;
    user-select: none;
}
.aipg-disclosure-summary::-webkit-details-marker { display: none; }
.aipg-chevron {
    display: inline-block;
    transition: transform 0.2s ease;
    color: #94a3b8;
    font-weight: 700;
}
details[open] > .aipg-disclosure-summary .aipg-chevron,
details[open] > .aipg-folder-summary .aipg-chevron,
details[open] > .aipg-task-desc-trigger .aipg-chevron { transform: rotate(90deg); }

.aipg-hints {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 16px;
    padding: 14px 0 4px;
}
.aipg-hint-row { display: flex; flex-direction: column; gap: 4px; }
.aipg-hint-row-wide { grid-column: 1 / -1; }

/* ─────────────────────────────────────────────────────────────────────
   File drop
   ───────────────────────────────────────────────────────────────────── */
.aipg-file-drop {
    margin-top: 10px;
    display: block;
    border: 1.5px dashed #cbd5e1;
    border-radius: 12px;
    padding: 16px;
    background: #f8fafc;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
    text-align: center;
}
.aipg-file-drop:hover:not(.is-disabled) {
    border-color: #2F3990;
    background: #eef2ff;
}
.aipg-file-drop.is-disabled { cursor: not-allowed; opacity: 0.7; }
.aipg-file-drop input[type=file] { display: none; }
.aipg-file-drop-inner {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    flex-wrap: wrap;
    justify-content: center;
}
.aipg-file-drop-ok { color: #15803d; }
.aipg-tick {
    background: #dcfce7;
    color: #15803d;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
}
.aipg-upload-icon {
    background: #ffffff;
    border: 1px solid #cbd5e1;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #64748b;
}
.aipg-btn-link {
    background: none;
    border: none;
    color: #2F3990;
    cursor: pointer;
    padding: 0 4px;
    font: inherit;
    text-decoration: underline;
}
.aipg-btn-link:hover:not(:disabled) { color: #252D75; }
.aipg-btn-link:disabled { color: #cbd5e1; cursor: not-allowed; text-decoration: none; }

/* ─────────────────────────────────────────────────────────────────────
   Clarification questions
   ───────────────────────────────────────────────────────────────────── */
.aipg-section-title {
    margin: 0 0 12px;
    font-size: 14px;
    font-weight: 600;
    color: #2F3990;
}
.aipg-q-row + .aipg-q-row { margin-top: 12px; }

/* ─────────────────────────────────────────────────────────────────────
   Plan preview header
   ───────────────────────────────────────────────────────────────────── */
.aipg-plan-header {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    padding: 16px 18px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.aipg-plan-head-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}
.aipg-icon-pill {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    font-size: 18px;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);
}
.aipg-project-name {
    font-size: 18px;
    font-weight: 700;
    flex: 1 1 auto;
    min-width: 0;
}
/* Sits in the same muted line as the sprint/task counts — informational, not a
   number the user has to act on. Tabular figures so it does not jitter while
   the plan is still being edited. */
.aipg-usage {
    font-variant-numeric: tabular-nums;
    cursor: help;
    border-bottom: 1px dotted #cbd5e1;
}

.aipg-code-pill {
    background: #f1f5f9;
    color: #475569;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
    letter-spacing: 0.5px;
}
.aipg-plan-description {
    margin: 10px 0 12px;
    color: #475569;
    font-size: 13px;
}
.aipg-required { color: #dc2626; }
/* Second field in a shared card: separated by space, not another border. */
.aipg-field-label-stacked { margin-top: 18px; }
.aipg-plan-skills,
.aipg-skills-select {
    margin-top: 10px;   /* same helper-to-control gap as .aipg-file-drop */
}
.aipg-chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
}
.aipg-chip {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
}
.aipg-chip-app { background: #eef2ff; color: #252D75; }

/* ─────────────────────────────────────────────────────────────────────
   Folder / sprint / task tree
   ───────────────────────────────────────────────────────────────────── */
.aipg-folder-list { display: flex; flex-direction: column; gap: 10px; }
.aipg-folder {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 4px 14px;
    transition: border-color 0.15s ease;
}
.aipg-folder[open] { border-color: #c7d2fe; }
.aipg-folder-summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 0;
    font-weight: 600;
    user-select: none;
}
.aipg-folder-summary::-webkit-details-marker { display: none; }
.aipg-folder-name {
    font-size: 14px;
    font-weight: 600;
    flex: 1 1 0;
    min-width: 0;
}
.aipg-pill {
    background: #f1f5f9;
    color: #475569;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
}
.aipg-pill-sm { padding: 1px 8px; font-size: 11px; }

.aipg-sprint {
    border-left: 2px solid #e2e8f0;
    padding: 8px 0 8px 16px;
    margin: 4px 4px 10px 8px;
}
.aipg-sprint-head { display: flex; align-items: center; gap: 8px; }
.aipg-sprint-name { font-size: 13px; font-weight: 600; flex: 0 1 auto; }
.aipg-task-list { list-style: none; padding: 0; margin: 8px 0 0; }
.aipg-task {
    padding: 6px 0;
    border-bottom: 1px solid #f1f5f9;
}
.aipg-task:last-child { border-bottom: none; }
.aipg-task-name {
    width: 100%;
    font-size: 13px;
    color: #0f172a;
}
.aipg-task-desc { margin-top: 4px; }
.aipg-task-desc-trigger {
    list-style: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #64748b;
    font-size: 12px;
    user-select: none;
}
.aipg-task-desc-trigger::-webkit-details-marker { display: none; }
.aipg-chevron-sm { font-size: 14px; }
.aipg-task-desc-body {
    white-space: pre-wrap;
    word-break: break-word;
    background: #f8fafc;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 12px;
    line-height: 1.5;
    margin: 6px 0 0;
    color: #334155;
}

/* ─────────────────────────────────────────────────────────────────────
   Execution progress
   ───────────────────────────────────────────────────────────────────── */
.aipg-exec-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
}
.aipg-exec-title { margin: 0; font-size: 16px; font-weight: 700; }
.aipg-success-tick {
    background: #dcfce7;
    color: #15803d;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
}
.aipg-error-tick {
    background: #fee2e2;
    color: #b91c1c;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
}
.aipg-progress-list { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.aipg-progress-row {
    display: grid;
    grid-template-columns: 28px 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 10px;
    background: #f8fafc;
    border: 1px solid #e5e7eb;
    color: #64748b;
    font-size: 13px;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.aipg-progress-icon {
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: #e5e7eb;
    color: #64748b;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 13px;
}
.aipg-progress-label { font-weight: 500; color: #0f172a; }
.aipg-progress-status { color: #94a3b8; font-size: 12px; }
.aipg-progress-row-active {
    background: #eef2ff;
    border-color: #c7d2fe;
}
.aipg-progress-row-active .aipg-progress-icon {
    background: #c7d2fe;
    color: #252D75;
}
.aipg-progress-row-active .aipg-progress-status { color: #2F3990; }
.aipg-progress-row-done {
    background: #f0fdf4;
    border-color: #bbf7d0;
}
.aipg-progress-row-done .aipg-progress-icon {
    background: #bbf7d0;
    color: #15803d;
}
.aipg-progress-row-done .aipg-progress-status { color: #15803d; }

/* ─────────────────────────────────────────────────────────────────────
   Alerts + actions
   ───────────────────────────────────────────────────────────────────── */
.aipg-alert {
    border-radius: 10px;
    padding: 10px 14px;
    font-size: 13px;
    line-height: 1.45;
}
.aipg-alert-danger { background: #fee2e2; color: #b91c1c; }
.aipg-alert-hint { margin: 6px 0 0; font-size: 12px; opacity: 0.85; }

.aipg-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 8px;
}
.aipg-actions-split { justify-content: space-between; }

/* ─────────────────────────────────────────────────────────────────────
   Buttons
   ───────────────────────────────────────────────────────────────────── */
.aipg-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-width: 130px;
    padding: 9px 18px;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    border: 1px solid transparent;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.05s ease;
    user-select: none;
}
.aipg-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.18);
}
.aipg-btn:active:not(:disabled) { transform: translateY(1px); }
.aipg-btn:disabled { cursor: not-allowed; opacity: 0.55; }

.aipg-btn-primary {
    background: #2F3990;
    color: #ffffff;
    border-color: #2F3990;
}
.aipg-btn-primary:hover:not(:disabled) {
    background: #252D75;
    border-color: #252D75;
}

.aipg-btn-ghost {
    background: #ffffff;
    color: #0f172a;
    border-color: #e5e7eb;
}
.aipg-btn-ghost:hover:not(:disabled) {
    background: #f8fafc;
    border-color: #cbd5e1;
}

/* ─────────────────────────────────────────────────────────────────────
   AI working status panel
   ───────────────────────────────────────────────────────────────────── */
.aipg-status-panel {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    background: #eef2ff;
    border: 1px solid #c7d2fe;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(47, 57, 144, 0.07);
}
.aipg-status-spinner {
    flex-shrink: 0;
    width: 22px !important;
    height: 22px !important;
    border: 2.5px solid rgba(47, 57, 144, 0.18) !important;
    border-top-color: #2F3990 !important;
}
.aipg-status-panel-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
}
.aipg-status-panel-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #2F3990;
}
.aipg-status-panel-sub {
    margin: 0;
    font-size: 12px;
    color: #4338ca;
    opacity: 0.8;
}

/* ─────────────────────────────────────────────────────────────────────
   Spinner
   ───────────────────────────────────────────────────────────────────── */
.aipg-spinner {
    display: inline-block;
    width: 18px;
    height: 18px;
    border: 2px solid rgba(79, 70, 229, 0.2);
    border-top-color: #2F3990;
    border-radius: 999px;
    animation: aipg-spin 0.7s linear infinite;
    vertical-align: middle;
}
.aipg-btn-primary .aipg-spinner {
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #ffffff;
}
.aipg-spinner-sm { width: 14px; height: 14px; border-width: 2px; }
.aipg-spinner-xs { width: 11px; height: 11px; border-width: 2px; }
@keyframes aipg-spin {
    to { transform: rotate(360deg); }
}

/* ─────────────────────────────────────────────────────────────────────
   Transitions
   ───────────────────────────────────────────────────────────────────── */
.aipg-fade-enter-active, .aipg-fade-leave-active { transition: opacity 0.2s ease; }
.aipg-fade-enter-from, .aipg-fade-leave-to { opacity: 0; }

/* ─────────────────────────────────────────────────────────────────────
   Mobile tweaks
   ───────────────────────────────────────────────────────────────────── */
@media (max-width: 640px) {
    .aipg-wrapper { padding: 16px 14px 24px; }
    .aipg-hints { grid-template-columns: 1fr; }
    .aipg-btn { min-width: 100px; }
    .aipg-step-label { display: none; }
}
</style>
