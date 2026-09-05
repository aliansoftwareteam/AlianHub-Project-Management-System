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
                {{ $t('AiProject.title') }}
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
                <ol class="aipg-stepper" role="list">
                    <li class="aipg-step" :class="stepClass('input')">
                        <span class="aipg-step-dot">{{ stepDoneDot('input', '1') }}</span>
                        <span class="aipg-step-label">{{ $t('AiProject.step_describe') }}</span>
                    </li>
                    <li class="aipg-step-line" :class="{ 'done': isStepDone('input') }"></li>
                    <li class="aipg-step" :class="stepClass('clarify')">
                        <span class="aipg-step-dot">{{ stepDoneDot('clarify', '2') }}</span>
                        <span class="aipg-step-label">{{ $t('AiProject.step_clarify') }}</span>
                    </li>
                    <li class="aipg-step-line" :class="{ 'done': isStepDone('clarify') }"></li>
                    <li class="aipg-step" :class="stepClass('brief')">
                        <span class="aipg-step-dot">{{ stepDoneDot('brief', '3') }}</span>
                        <span class="aipg-step-label">{{ $t('AiProject.step_brief') }}</span>
                    </li>
                    <li class="aipg-step-line" :class="{ 'done': isStepDone('brief') }"></li>
                    <li class="aipg-step" :class="stepClass('preview')">
                        <span class="aipg-step-dot">{{ stepDoneDot('preview', '4') }}</span>
                        <span class="aipg-step-label">{{ $t('AiProject.step_plan') }}</span>
                    </li>
                    <li class="aipg-step-line" :class="{ 'done': isStepDone('preview') }"></li>
                    <li class="aipg-step" :class="stepClass('executing', 'done')">
                        <span class="aipg-step-dot">{{ step === 'done' ? '✓' : '5' }}</span>
                        <span class="aipg-step-label">{{ $t('AiProject.step_create') }}</span>
                    </li>
                </ol>

                <!-- STEP 1: INPUT -->
                <section v-if="step === 'input'" class="aipg-section">
                    <div class="aipg-card">
                        <label class="aipg-field-label">{{ $t('AiProject.describe_label') }}</label>
                        <textarea
                            v-model="description"
                            class="aipg-textarea"
                            rows="7"
                            :placeholder="placeholderText"
                            :disabled="loading"></textarea>
                        <div class="aipg-helper-row">
                            <span class="aipg-helper" :class="{ 'aipg-helper-ok': description.length >= 20 }">
                                {{ $t('AiProject.min_chars', { count: description.length, min: 20 }) }}
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
                            <p class="aipg-alert-hint">Click <strong>{{ $t('AiProject.continue') }}</strong> again — the AI will retry from your description.</p>
                        </div>
                    </transition>

                    <transition name="aipg-fade">
                        <div v-if="clarifyLoading || loading" class="aipg-status-panel" role="status" aria-live="polite">
                            <span class="aipg-spinner aipg-status-spinner" aria-hidden="true"></span>
                            <div class="aipg-status-panel-text">
                                <p class="aipg-status-panel-title">
                                    {{ clarifyLoading ? $t('AiProject.analyzing') : $t('AiProject.generating_plan') }}
                                </p>
                                <p class="aipg-status-panel-sub">
                                    {{ clarifyLoading ? $t('AiProject.analyzing_sub') : $t('AiProject.generating_plan_sub') }}
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
                            {{ clarifyLoading ? $t('AiProject.analyzing') : (loading ? $t('AiProject.generating_plan') : 'Re-Generate Plan') }}
                        </button>
                        <button
                            class="aipg-btn aipg-btn-primary"
                            :disabled="loading || briefUploading || clarifyLoading"
                            @click="onNextWithExistingPlan">
                            Next →
                        </button>
                    </div>
                    <div v-else-if="hasGeneratedQuestions" class="aipg-actions aipg-actions-split">
                        <button
                            class="aipg-btn aipg-btn-ghost"
                            :disabled="!canGenerate || loading || briefUploading || clarifyLoading"
                            @click="onRegenerateQuestions">
                            <span v-if="clarifyLoading || loading" class="aipg-spinner aipg-spinner-sm" aria-hidden="true"></span>
                            {{ clarifyLoading ? $t('AiProject.analyzing') : (loading ? $t('AiProject.generating_plan') : 'Re-Generate Questions') }}
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
                            data-test="start"
                            :disabled="!canGenerate || loading || briefUploading || clarifyLoading"
                            @click="onGeneratePlan">
                            <span v-if="loading || clarifyLoading" class="aipg-spinner aipg-spinner-sm" aria-hidden="true"></span>
                            {{ clarifyLoading ? $t('AiProject.analyzing') : (loading ? $t('AiProject.generating_plan') : (error ? $t('AiProject.try_again') : $t('AiProject.continue'))) }}
                        </button>
                    </div>
                </section>

                <!-- STEP 2: CLARIFY -->
                <section v-else-if="step === 'clarify'" class="aipg-section">
                    <div v-if="coverage" class="aipg-card aipg-coverage-card" data-test="coverage">
                        <label class="aipg-field-label-sm">{{ $t('AiProject.coverage_title') }}</label>
                        <CoverageChips :coverage="coverage"/>
                        <p class="aipg-helper aipg-coverage-hint">
                            {{ $t('AiProject.round_of', { round: clarifyRound, max: clarifyMaxRounds }) }}
                            · {{ $t('AiProject.unknown_hint') }}
                        </p>
                    </div>
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

                <!-- STEP 3: BRIEF -->
                <section v-else-if="step === 'brief'" class="aipg-section">
                    <div v-if="coverage" class="aipg-card aipg-coverage-card">
                        <label class="aipg-field-label-sm">{{ $t('AiProject.coverage_title') }}</label>
                        <CoverageChips :coverage="coverage"/>
                    </div>
                    <BriefStep
                        :original="description"
                        :draft="briefMarkdown"
                        :assumptions="briefAssumptions"
                        :approved="briefApproved"
                        :edited-since-approval="briefEditedSinceApproval"
                        :loading="briefLoading"
                        :generating="loading"
                        :error-message="briefError"
                        :plan-error="error"
                        @update:draft="onBriefEdit"
                        @approve="onApproveBrief"
                        @generate="onGenerateFromBrief"
                        @regenerate="startBrief"
                        @retry="startBrief"
                        @skip="onSkipBrief"
                        @back="onBriefBack"
                    />
                </section>

                <!-- STEP 4: PREVIEW -->
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
                        <p v-if="splitSummary" class="aipg-split-summary" data-test="split-summary">
                            {{ $t('AiProject.split_summary', splitSummary) }}
                        </p>
                        <div class="aipg-plan-skills">
                            <label class="aipg-field-label-sm">{{ $t('ProjectDetails.skills') }}</label>
                            <SkillsSelect v-model="skills" :bordered="true" :showAll="true"/>
                        </div>
                    </div>

                    <div v-if="planAssumptions.length" class="aipg-card aipg-card-accent" data-test="plan-assumptions">
                        <label class="aipg-field-label">{{ $t('AiProject.assumptions_title') }}</label>
                        <ul class="aipg-assumption-list">
                            <li v-for="(a, i) in planAssumptions" :key="i">
                                <span v-if="a.point" class="aipg-chip aipg-chip-app aipg-chip-xs">{{ $t(`AiProject.point_${a.point}`) }}</span>
                                {{ a.text }}
                            </li>
                        </ul>
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
                                    <div class="aipg-task-row">
                                        <input
                                            v-model="task.TaskName"
                                            class="aipg-input-plain aipg-task-name"
                                            maxlength="200"
                                            :disabled="loading"/>
                                        <SplitBadge :split="task.split"/>
                                    </div>
                                    <details class="aipg-task-desc">
                                        <summary class="aipg-task-desc-trigger">
                                            <span class="aipg-chevron aipg-chevron-sm" aria-hidden="true">›</span>
                                            Description
                                        </summary>
                                        <pre class="aipg-task-desc-body">{{ renderTaskDescription(task) }}</pre>
                                    </details>
                                    <span v-if="task.estimatedHours" class="aipg-task-est">{{ formatHours(task.estimatedHours) }}</span>
                                    <div v-if="task.subtasks && task.subtasks.length" class="aipg-subs">
                                        <div v-for="(st, sti) in task.subtasks" :key="'st-'+si+'-'+ti+'-'+sti" class="aipg-sub">
                                            ↳ {{ st.TaskName }}<span v-if="st.estimatedHours" class="aipg-sub-est">{{ formatHours(st.estimatedHours) }}</span>
                                            <SplitBadge :split="st.split"/>
                                        </div>
                                    </div>
                                </li>
                            </ul>
                        </details>
                    </div>

                    <GuidePreview
                        v-if="approvedBrief"
                        :guide="guide"
                        :markdown="guideMarkdown"
                        :loading="guideLoading"
                        :error-message="guideError"
                        @retry="loadGuide"
                        @update:markdown="(v) => guideMarkdown = v"
                    />

                    <transition name="aipg-fade">
                        <div v-if="error" class="aipg-alert aipg-alert-danger">{{ error }}</div>
                    </transition>

                    <div class="aipg-actions aipg-actions-split">
                        <button class="aipg-btn aipg-btn-ghost" @click="onPreviewBack" :disabled="loading">
                            {{ $t('AiProject.back') }}
                        </button>
                        <button class="aipg-btn aipg-btn-primary" :disabled="loading" data-test="create-everything" @click="onApprovePlan">
                            <span v-if="loading" class="aipg-spinner aipg-spinner-sm" aria-hidden="true"></span>
                            {{ loading ? $t('AiProject.starting') : $t('AiProject.create_everything') }}
                        </button>
                    </div>
                </section>

                <!-- STEP 5: EXECUTING / DONE -->
                <section v-else-if="step === 'executing' || step === 'done'" class="aipg-section">
                    <div class="aipg-exec-head">
                        <span v-if="step === 'executing'" class="aipg-spinner" aria-hidden="true"></span>
                        <span v-else class="aipg-success-tick" aria-hidden="true">✓</span>
                        <h4 class="aipg-exec-title">{{ step === 'done' ? $t('AiProject.all_done') : $t('AiProject.building') }}</h4>
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

                    <div v-if="step === 'done' && hasOutcome" class="aipg-card aipg-outcome" data-test="outcome">
                        <p class="aipg-outcome-line">
                            <span class="aipg-chip aipg-chip-app">⚡ {{ $t('AiProject.runs_queued', { n: outcome.runsQueued }) }}</span>
                        </p>
                        <div v-if="outcome.runsRefused.length" class="aipg-outcome-refused" data-test="runs-refused">
                            <label class="aipg-field-label-sm">{{ $t('AiProject.runs_refused_title') }}</label>
                            <ul class="aipg-assumption-list">
                                <li v-for="(r, i) in outcome.runsRefused" :key="i">
                                    <strong v-if="r.taskName || r.title">{{ r.taskName || r.title }}</strong>
                                    <span v-if="r.reason"> — {{ r.reason }}</span>
                                </li>
                            </ul>
                        </div>
                        <button
                            v-if="outcome.guideAgentId"
                            type="button"
                            class="aipg-btn-link aipg-outcome-guide"
                            data-test="open-guide"
                            @click="onOpenGuideAgent">
                            {{ $t('AiProject.open_guide_agent') }}
                        </button>
                    </div>

                    <div v-if="step === 'done'" class="aipg-actions">
                        <button class="aipg-btn aipg-btn-primary" data-test="open-project" @click="onOpenProject">
                            {{ $t('AiProject.open_project') }}
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
import CoverageChips from './brief/CoverageChips.vue';
import BriefStep from './brief/BriefStep.vue';
import SplitBadge from './plan/SplitBadge.vue';
import GuidePreview from './plan/GuidePreview.vue';
import { POINTS } from './brief/points';
import { useAiProjectGenerator } from '@/composable/aiProjectGenerator';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import SkillsSelect from '@/components/molecules/SkillsSelect/SkillsSelect.vue';
import ProjectSourceSelect from '@/components/molecules/ProjectSourceSelect/ProjectSourceSelect.vue';
import { PROJECT_SOURCES, checkProposalId } from '@/utils/projectSource';
import { useI18n } from 'vue-i18n';

export default defineComponent({
    name: 'AiProjectCreator',
    components: { Sidebar, ClarifyStep, CoverageChips, BriefStep, SplitBadge, GuidePreview, SkillsSelect, ProjectSourceSelect },
    props: {
        visible: { type: Boolean, default: false },
    },
    emits: ['close', 'created'],
    setup(props, { emit }) {
        const clientWidth = inject('$clientWidth') || ref(window.innerWidth);
        const api = useAiProjectGenerator();
        const store = useStore();
        const route = useRoute();
        const router = useRouter();
        const { t } = useI18n();

        const step = ref('input'); // input | clarify | brief | preview | executing | done | error
        const loading = ref(false);
        const briefUploading = ref(false);
        const error = ref('');
        const rolledBack = ref(false);

        // Clarify is optional: zero questions (coverage all met) or a failed
        // /clarify call both skip it, so the wizard never depends on it.
        const clarifyLoading = ref(false);
        const clarifyQuestions = ref([]);
        const clarifyUnderstanding = ref('');
        const clarifyError = ref('');
        // Sent verbatim into /plan as `clarifications`; also the `answers` /brief gets.
        const clarifications = ref(null);
        const coverage = ref(null);
        const clarifyRound = ref(0);
        const clarifyMaxRounds = ref(2);
        // Answers accumulate across rounds; a round asks only about points still missing.
        const answers = ref([]);

        const briefLoading = ref(false);
        const briefError = ref('');
        const briefDraft = ref(null);
        const briefMarkdown = ref('');
        const briefApproved = ref(false);
        const briefEditedSinceApproval = ref(false);
        // Frozen at approval: what /plan, /guide and /execute receive. Editing after
        // approval clears it so the plan can never be built from unapproved text.
        const approvedBrief = ref('');

        const guide = ref(null);
        const guideMarkdown = ref('');
        const guideLoading = ref(false);
        const guideError = ref('');

        const outcome = reactive({ guideAgentId: null, runsQueued: 0, runsRefused: [] });

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

        const briefAssumptions = computed(() => {
            const list = briefDraft.value && Array.isArray(briefDraft.value.assumptions) ? briefDraft.value.assumptions : [];
            return list.filter((a) => a && a.text);
        });

        const planAssumptions = computed(() => {
            const echoed = plan.value && Array.isArray(plan.value.assumptions) ? plan.value.assumptions.filter((a) => a && a.text) : [];
            return echoed.length ? echoed : briefAssumptions.value;
        });

        // Older plans carry no split at all; counting the labels ourselves keeps the
        // summary honest when the server forgot the totals but not the labels.
        const splitSummary = computed(() => {
            const p = plan.value;
            if (!p) return null;
            const s = p.splitSummary;
            if (s && typeof s === 'object') {
                return { agent: Number(s.agent) || 0, agentAfter: Number(s.agentAfter) || 0, person: Number(s.person) || 0 };
            }
            const counts = { agent: 0, agentAfter: 0, person: 0 };
            let labelled = 0;
            for (const sp of p.sprints || []) {
                for (const task of sp.tasks || []) {
                    const label = task.split && task.split.label;
                    if (!label) continue;
                    labelled += 1;
                    if (label === 'agent') counts.agent += 1;
                    else if (label === 'agent-after') counts.agentAfter += 1;
                    else counts.person += 1;
                }
            }
            return labelled ? counts : null;
        });

        const hasOutcome = computed(() => outcome.runsQueued > 0 || outcome.runsRefused.length > 0 || !!outcome.guideAgentId);

        // What this run cost. One wizard run can be two LLM calls — the clarify
        // round and the plan itself — so both are collected and added up;
        // reporting only the plan would undercount every run that asked
        // questions first.
        const clarifyUsage = ref(null);
        const briefUsage = ref(null);
        const planUsage = ref(null);

        const runUsage = computed(() => {
            const parts = [clarifyUsage.value, briefUsage.value, planUsage.value].filter(Boolean);
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

        // "2h" and "1h 30m" read better than "1.5" against a task name.
        const formatHours = (h) => {
            const total = Math.round((Number(h) || 0) * 60);
            if (total <= 0) return '';
            const hours = Math.floor(total / 60);
            const mins = total % 60;
            if (!hours) return `${mins}m`;
            return mins ? `${hours}h ${mins}m` : `${hours}h`;
        };

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
            const order = ['input', 'clarify', 'brief', 'preview', 'executing', 'done'];
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

        function resetBriefFlow() {
            clarifications.value = null;
            coverage.value = null;
            clarifyRound.value = 0;
            answers.value = [];
            briefDraft.value = null;
            briefMarkdown.value = '';
            briefApproved.value = false;
            briefEditedSinceApproval.value = false;
            approvedBrief.value = '';
            briefError.value = '';
            guide.value = null;
            guideMarkdown.value = '';
            guideError.value = '';
        }

        function applyClarifyResponse(res) {
            if (res && res.usage) clarifyUsage.value = res.usage;
            if (res && res.coverage && typeof res.coverage === 'object') coverage.value = res.coverage;
            if (res && Number(res.maxRounds) > 0) clarifyMaxRounds.value = Number(res.maxRounds);
            const questions = res && res.status && Array.isArray(res.questions) ? res.questions : [];
            if (!questions.length) return false;
            clarifyRound.value = Number(res.round) > 0 ? Number(res.round) : clarifyRound.value + 1;
            clarifyQuestions.value = questions;
            clarifyUnderstanding.value = res.understanding || '';
            return true;
        }

        // Entry point from Step 1. Questions come back only for points the brief
        // misses; none at all (or a failed call) goes straight to the brief draft.
        async function onGeneratePlan() {
            if (!canGenerate.value) return;
            error.value = '';
            clarifyError.value = '';
            resetBriefFlow();
            clarifyLoading.value = true;
            try {
                const res = await api.generateClarifyingQuestions({
                    description: description.value.trim(),
                    briefId: briefId.value,
                });
                clarifyLoading.value = false;
                if (applyClarifyResponse(res)) {
                    step.value = 'clarify';
                    return;
                }
                await startBrief();
            } catch (e) {
                clarifyLoading.value = false;
                await startBrief();
            }
        }

        async function runPlanGeneration(clarificationsPayload) {
            loading.value = true;
            error.value = '';
            const retryStep = approvedBrief.value ? 'brief' : 'input';
            try {
                const result = await api.generatePlan({
                    description: description.value.trim(),
                    briefId: briefId.value,
                    isPrivateSpace: isPrivateSpace.value,
                    clarifications: clarificationsPayload,
                    // The plan has to be built for the chosen technology, not
                    // merely tagged with it afterwards.
                    skills: skills.value,
                    approvedBrief: approvedBrief.value || null,
                    assumptions: briefAssumptions.value,
                });
                if (!result || !result.status) {
                    error.value = (result && result.statusText) || 'Plan generation failed. Please try again.';
                    step.value = retryStep;
                    return;
                }
                if (!result.plan) {
                    error.value = 'The AI did not return a plan. Please try again.';
                    step.value = retryStep;
                    return;
                }
                plan.value = result.plan;
                planId.value = result.planId;
                planUsage.value = result.usage || null;
                mergeSuggestedSkills(result.plan);
                step.value = 'preview';
                if (approvedBrief.value) loadGuide();
            } catch (e) {
                error.value = friendlyErr(e);
                step.value = retryStep;
            } finally {
                loading.value = false;
            }
        }

        async function startBrief() {
            step.value = 'brief';
            error.value = '';
            briefError.value = '';
            briefApproved.value = false;
            briefEditedSinceApproval.value = false;
            approvedBrief.value = '';
            briefLoading.value = true;
            try {
                const res = await api.generateBrief({
                    description: description.value.trim(),
                    briefId: briefId.value,
                    answers: answers.value,
                });
                if (res && res.usage) briefUsage.value = res.usage;
                if (res && res.coverage && typeof res.coverage === 'object') coverage.value = res.coverage;
                const draft = res && res.status && res.brief;
                if (!draft || typeof draft.markdown !== 'string' || !draft.markdown.trim()) {
                    briefError.value = (res && res.statusText) || t('AiProject.brief_failed');
                    return;
                }
                briefDraft.value = draft;
                briefMarkdown.value = draft.markdown;
            } catch (e) {
                briefError.value = friendlyErr(e);
            } finally {
                briefLoading.value = false;
            }
        }

        function onBriefEdit(text) {
            briefMarkdown.value = text;
            if (briefApproved.value) {
                briefApproved.value = false;
                briefEditedSinceApproval.value = true;
            }
            approvedBrief.value = '';
        }

        function onApproveBrief() {
            if (!briefMarkdown.value.trim()) return;
            approvedBrief.value = briefMarkdown.value;
            briefApproved.value = true;
            briefEditedSinceApproval.value = false;
        }

        async function onGenerateFromBrief() {
            if (!briefApproved.value || !approvedBrief.value) return;
            await runPlanGeneration(clarifications.value);
        }

        // Escape hatch when /brief is unavailable: the plan is built the old way.
        async function onSkipBrief() {
            approvedBrief.value = '';
            briefApproved.value = false;
            await runPlanGeneration(clarifications.value);
        }

        function onBriefBack() {
            error.value = '';
            step.value = hasGeneratedQuestions.value ? 'clarify' : 'input';
        }

        function onPreviewBack() {
            error.value = '';
            step.value = approvedBrief.value ? 'brief' : 'input';
        }

        async function loadGuide() {
            if (!approvedBrief.value || !plan.value) return;
            guideLoading.value = true;
            guideError.value = '';
            try {
                const res = await api.generateGuide({
                    approvedBrief: approvedBrief.value,
                    assumptions: planAssumptions.value,
                    plan: plan.value,
                });
                const g = res && res.status && res.guide;
                if (!g || typeof g !== 'object') {
                    guideError.value = (res && res.statusText) || t('AiProject.guide_failed');
                    return;
                }
                guide.value = g;
                guideMarkdown.value = typeof g.markdown === 'string' ? g.markdown : '';
            } catch (e) {
                guideError.value = friendlyErr(e);
            } finally {
                guideLoading.value = false;
            }
        }

        function guideForExecute() {
            if (!guide.value) return null;
            return { ...guide.value, markdown: guideMarkdown.value || guide.value.markdown || '' };
        }

        function applyOutcome(payload) {
            if (!payload || typeof payload !== 'object') return;
            if (payload.guideAgentId) outcome.guideAgentId = payload.guideAgentId;
            if (typeof payload.runsQueued === 'number') outcome.runsQueued = payload.runsQueued;
            if (Array.isArray(payload.runsRefused)) outcome.runsRefused = payload.runsRefused.filter(Boolean);
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

        // A second round is worth a call only while a missing point was never asked
        // about; an answered, skipped or "don't know" point is settled for this brief.
        function pointsStillUnasked(roundAnswers) {
            const cov = coverage.value || {};
            const asked = new Set(roundAnswers.map((a) => a.point).filter(Boolean));
            const everAsked = new Set(answers.value.map((a) => a.point).filter(Boolean));
            return POINTS.filter((p) => cov[p] === 'missing' && !asked.has(p) && !everAsked.has(p));
        }

        async function onClarifySubmit(roundAnswers) {
            const list = Array.isArray(roundAnswers) ? roundAnswers : [];
            const unasked = pointsStillUnasked(list);
            answers.value = [...answers.value, ...list];
            clarifications.value = answers.value;
            if (clarifyRound.value < clarifyMaxRounds.value && unasked.length) {
                clarifyLoading.value = true;
                try {
                    const res = await api.generateClarifyingQuestions({
                        description: description.value.trim(),
                        briefId: briefId.value,
                        previousAnswers: answers.value,
                    });
                    clarifyLoading.value = false;
                    if (applyClarifyResponse(res)) return;
                } catch (e) {
                    clarifyLoading.value = false;
                }
            }
            await startBrief();
        }

        // Back keeps the questions and answers so Step 1 can re-enter Clarify
        // without another LLM call.
        function onClarifyBack() {
            step.value = 'input';
            clarifyError.value = '';
        }

        async function onClarifyRetry() {
            clarifyError.value = '';
            clarifyLoading.value = true;
            try {
                const res = await api.generateClarifyingQuestions({
                    description: description.value.trim(),
                    briefId: briefId.value,
                    previousAnswers: answers.value,
                });
                clarifyLoading.value = false;
                if (!applyClarifyResponse(res)) await startBrief();
            } catch (e) {
                clarifyLoading.value = false;
                clarifyError.value = friendlyErr(e);
            }
        }

        async function onClarifySkipAll() {
            await startBrief();
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
                    approvedBrief: approvedBrief.value || null,
                    assumptions: planAssumptions.value,
                    guide: guideForExecute(),
                });
                if (!result || !result.status || !result.jobId) {
                    error.value = (result && result.statusText) || 'Execute failed';
                    return;
                }
                applyOutcome(result);
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
                    applyOutcome(payload);
                    // `created` waits for "Open project": parents close the sidebar on
                    // it, which would hide the queued-runs summary and the guide link.
                    step.value = 'done';
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

        function onOpenGuideAgent() {
            const id = outcome.guideAgentId;
            if (!id) return;
            const cid = route && route.params ? route.params.cid : undefined;
            onClose();
            router.push({ name: 'AiAgent', params: { cid, id } });
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
            briefUsage.value = null;
            clarifyLoading.value = false;
            clarifyQuestions.value = [];
            clarifyUnderstanding.value = '';
            clarifyError.value = '';
            briefLoading.value = false;
            guideLoading.value = false;
            resetBriefFlow();
            outcome.guideAgentId = null;
            outcome.runsQueued = 0;
            outcome.runsRefused = [];
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
            runUsage, usageTooltip, formatTokens, formatCost, formatHours,
            renderTaskDescription, isStepDone, stepClass, stepDoneDot, rowClass, stepIcon, stepStatusLabel,
            onFileChosen, clearBrief,
            onGeneratePlan, onNextWithExistingPlan,
            onRegenerateQuestions, onNextWithExistingQuestions,
            onApprovePlan, onOpenProject, onOpenGuideAgent, onRetry, onClose, onSidebarVisibleChange, onPreviewBack,
            clarifyLoading, clarifyQuestions, clarifyUnderstanding, clarifyError,
            coverage, clarifyRound, clarifyMaxRounds,
            onClarifySubmit, onClarifyBack, onClarifyRetry, onClarifySkipAll,
            briefLoading, briefError, briefMarkdown, briefApproved, briefEditedSinceApproval, briefAssumptions, approvedBrief,
            onBriefEdit, onApproveBrief, onGenerateFromBrief, onSkipBrief, onBriefBack, startBrief,
            planAssumptions, splitSummary,
            guide, guideMarkdown, guideLoading, guideError, loadGuide,
            outcome, hasOutcome,
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

.aipg-subs { margin: 2px 0 4px 12px; }
.aipg-sub {
    font-size: 12px; color: #6b7488; padding: 2px 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* The estimate is the number a reader scans for, so it gets the same quiet
   pill the project code uses rather than trailing off as plain grey text.
   Parent and sub-task are styled identically — a sub-task's two hours are
   worth exactly as much as a parent's. */
.aipg-sub-est, .aipg-task-est {
    display: inline-block;
    margin-left: 8px;
    padding: 1px 7px;
    border-radius: 999px;
    background: #f1f5f9;
    color: #475569;
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
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
.aipg-chip-xs { padding: 1px 8px; font-size: 11px; margin-right: 6px; }

.aipg-coverage-card { display: flex; flex-direction: column; gap: 8px; }
.aipg-coverage-hint { line-height: 1.5; }
.aipg-split-summary {
    margin: 8px 0 0;
    font-size: 13px;
    font-weight: 500;
    color: #2F3990;
}
.aipg-assumption-list {
    margin: 4px 0 0;
    padding-left: 18px;
    font-size: 13px;
    line-height: 1.5;
    color: #1e1b4b;
}
.aipg-assumption-list li + li { margin-top: 4px; }
.aipg-task-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.aipg-task-row .aipg-task-name { flex: 1 1 200px; }
.aipg-outcome { display: flex; flex-direction: column; gap: 10px; }
.aipg-outcome-line { margin: 0; }
.aipg-outcome-refused .aipg-assumption-list { color: #475569; }
.aipg-outcome-guide { align-self: flex-start; font-size: 13px; }

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
