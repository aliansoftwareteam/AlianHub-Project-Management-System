<template>
    <Sidebar
        v-if="visible"
        :visible="visible"
        :close-on-back-drop="step !== 'executing'"
        :width="clientWidth <= 768 ? '100%' : '780px'"
        :top="clientWidth <= 767 ? '0px' : '46px'"
        @update:visible="onClose">
        <template #head-left>
            <span class="aipg-head-title">
                <span class="aipg-spark" aria-hidden="true">✨</span>
                Create project with AI
            </span>
        </template>
        <template #head-right>
            <img
                v-if="step !== 'executing'"
                :src="closeIcon"
                alt="Close"
                class="aipg-close-icon"
                :class="{ 'aipg-close-icon-disabled': loading || briefUploading }"
                @click="(loading || briefUploading) ? null : onClose()"/>
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
                    <li class="aipg-step" :class="stepClass('preview')">
                        <span class="aipg-step-dot">{{ stepDoneDot('preview', '2') }}</span>
                        <span class="aipg-step-label">Review plan</span>
                    </li>
                    <li class="aipg-step-line" :class="{ 'done': isStepDone('preview') }"></li>
                    <li class="aipg-step" :class="stepClass('executing', 'done')">
                        <span class="aipg-step-dot">{{ step === 'done' ? '✓' : '3' }}</span>
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
                                Brief loaded · ~{{ briefStats.tokenEstimate }} tokens
                                <span v-if="briefStats.truncated" class="aipg-muted">(truncated)</span>
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

                    <div class="aipg-actions">
                        <button
                            class="aipg-btn aipg-btn-primary"
                            :disabled="!canGenerate || loading || briefUploading"
                            @click="onGeneratePlan">
                            <span v-if="loading" class="aipg-spinner aipg-spinner-sm" aria-hidden="true"></span>
                            {{ loading ? 'Generating plan…' : (error ? 'Try again' : 'Generate plan') }}
                        </button>
                    </div>
                </section>

                <!-- STEP 2: PREVIEW -->
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
                                {{ totals.folders }} folders · {{ totals.sprints }} sprints · {{ totals.tasks }} tasks
                            </span>
                        </div>
                        <p class="aipg-plan-description">{{ plan.project.description }}</p>
                        <div class="aipg-chip-row" v-if="plan.project.apps.length">
                            <span class="aipg-chip aipg-chip-app" v-for="a in plan.project.apps" :key="'app-'+a.key">{{ a.name }}</span>
                        </div>
                    </div>

                    <div class="aipg-folder-list">
                        <details
                            v-for="(folder, fi) in plan.folders"
                            :key="'f-'+fi"
                            class="aipg-folder"
                            :open="fi === 0">
                            <summary class="aipg-folder-summary">
                                <span class="aipg-chevron" aria-hidden="true">›</span>
                                <input
                                    v-model="folder.folderName"
                                    class="aipg-input-plain aipg-folder-name"
                                    maxlength="80"
                                    :disabled="loading"
                                    @click.stop/>
                                <span class="aipg-pill aipg-ml-auto">{{ countFolderTasks(folder) }} tasks</span>
                            </summary>
                            <div
                                v-for="(sprint, si) in folder.sprints"
                                :key="'s-'+fi+'-'+si"
                                class="aipg-sprint">
                                <div class="aipg-sprint-head">
                                    <input
                                        v-model="sprint.sprintName"
                                        class="aipg-input-plain aipg-sprint-name"
                                        maxlength="80"
                                        :disabled="loading"/>
                                    <span class="aipg-pill aipg-pill-sm aipg-ml-auto">{{ sprint.tasks.length }}</span>
                                </div>
                                <ul class="aipg-task-list">
                                    <li v-for="(task, ti) in sprint.tasks" :key="'t-'+fi+'-'+si+'-'+ti" class="aipg-task">
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
                                            <pre class="aipg-task-desc-body">{{ task.description }}</pre>
                                        </details>
                                    </li>
                                </ul>
                            </div>
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
                        <div class="aipg-progress-row" :class="rowClass('folder')">
                            <span class="aipg-progress-icon"><span v-html="stepIcon('folder')" /></span>
                            <span class="aipg-progress-label">Folders</span>
                            <span class="aipg-progress-status">{{ progress.foldersDone }} / {{ progress.totalFolders || '…' }}</span>
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
import { useAiProjectGenerator } from '@/composable/aiProjectGenerator';

export default defineComponent({
    name: 'AiProjectCreator',
    components: { Sidebar },
    props: {
        visible: { type: Boolean, default: false },
    },
    emits: ['close', 'created'],
    setup(props, { emit }) {
        const clientWidth = inject('$clientWidth') || ref(window.innerWidth);
        const api = useAiProjectGenerator();
        const closeIcon = require('@/assets/images/svg/CloseSidebar.svg');

        const step = ref('input'); // input | preview | executing | done | error
        const loading = ref(false);
        const briefUploading = ref(false);
        const error = ref('');
        const rolledBack = ref(false);

        const description = ref('');
        // No-frills hints. The clarification round-trip + target-task-count
        // slider were removed in favour of a one-shot plan call — fewer
        // moving parts, no cached conversation state to expire, retryable
        // without "Conversation not found" errors when the proxy 504s.
        const hints = reactive({});
        // Mirrors the manual flow's workspace step: 'public' → private=false.
        // We force this onto the plan server-side so the user's choice always
        // wins over whatever the LLM picked.
        const isPrivateSpace = ref(false);
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
            foldersDone: 0,
            totalFolders: 0,
            folderState: 'pending',
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

        const totals = computed(() => {
            if (!plan.value) return { folders: 0, sprints: 0, tasks: 0 };
            let s = 0; let t = 0;
            for (const f of plan.value.folders) {
                s += f.sprints.length;
                for (const sp of f.sprints) t += sp.tasks.length;
            }
            return { folders: plan.value.folders.length, sprints: s, tasks: t };
        });

        function countFolderTasks(folder) {
            return folder.sprints.reduce((acc, s) => acc + s.tasks.length, 0);
        }

        function isStepDone(name) {
            const order = ['input', 'preview', 'executing', 'done'];
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

        function cleanHints() {
            return { isPrivateSpace: !!isPrivateSpace.value };
        }

        async function onGeneratePlan() {
            if (!canGenerate.value) return;
            loading.value = true;
            error.value = '';
            try {
                // Async plan job: the composable waits on SSE and resolves
                // with the final plan without holding the POST request open.
                const result = await api.generatePlan({
                    description: description.value.trim(),
                    hints: cleanHints(),
                    briefId: briefId.value,
                    isPrivateSpace: isPrivateSpace.value,
                });
                if (!result || !result.status) {
                    error.value = (result && result.statusText) || 'Plan generation failed. Please try again.';
                    return;
                }
                if (!result.plan) {
                    error.value = 'The AI did not return a plan. Please try again.';
                    return;
                }
                plan.value = result.plan;
                planId.value = result.planId;
                step.value = 'preview';
            } catch (e) {
                error.value = friendlyErr(e);
            } finally {
                loading.value = false;
            }
        }

        function buildEdits() {
            const p = plan.value;
            return {
                project: {
                    ProjectName: p.project.ProjectName,
                    description: p.project.description,
                },
                folders: p.folders.map((f) => ({
                    folderName: f.folderName,
                    sprints: f.sprints.map((s) => ({
                        sprintName: s.sprintName,
                        tasks: s.tasks.map((t) => ({ TaskName: t.TaskName })),
                    })),
                })),
            };
        }

        async function onApprovePlan() {
            if (!plan.value) return;
            loading.value = true;
            error.value = '';
            try {
                const result = await api.execute({
                    plan: plan.value,
                    edits: buildEdits(),
                    userName: '',
                    isPrivateSpace: isPrivateSpace.value,
                });
                if (!result || !result.status || !result.jobId) {
                    error.value = (result && result.statusText) || 'Execute failed';
                    return;
                }
                jobId.value = result.jobId;
                step.value = 'executing';
                progress.totalFolders = totals.value.folders;
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
                    if (payload.step === 'project') progress.project = payload.status === 'done' ? 'done' : 'active';
                    if (payload.step === 'folder') {
                        progress.folderState = 'active';
                        if (payload.status === 'done') progress.foldersDone += 1;
                    }
                    if (payload.step === 'sprint') {
                        progress.sprintState = 'active';
                        if (payload.status === 'done') progress.sprintsDone += 1;
                    }
                    if (payload.step === 'tasks') {
                        progress.tasksState = 'active';
                        if (typeof payload.completed === 'number') progress.tasksDone = payload.completed;
                        if (typeof payload.total === 'number') progress.totalTasks = payload.total;
                    }
                    if (payload.step === 'sprint') progress.folderState = 'done';
                    if (payload.step === 'tasks') {
                        progress.folderState = 'done';
                        progress.sprintState = 'done';
                    }
                } else if (payload.event === 'complete') {
                    progress.project = 'done';
                    progress.folderState = 'done';
                    progress.sprintState = 'done';
                    progress.tasksState = 'done';
                    progress.foldersDone = (payload.totals && payload.totals.folders) || progress.foldersDone;
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
            progress.folderState = 'pending';
            progress.sprintState = 'pending';
            progress.tasksState = 'pending';
            progress.foldersDone = 0;
            progress.sprintsDone = 0;
            progress.tasksDone = 0;
            progress.totalFolders = 0;
            progress.totalSprints = 0;
            progress.totalTasks = 0;
            progress.lastEvent = '';
            rolledBack.value = false;
            briefUploading.value = false;
            isPrivateSpace.value = false;
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
            closeIcon,
            clientWidth, step, loading, briefUploading, error, rolledBack,
            description, hints, isPrivateSpace, briefFile, briefId, briefStats,
            plan, planId, editableProjectName,
            jobId, progress, createdProjectId,
            placeholderText,
            canGenerate, totals,
            countFolderTasks, isStepDone, stepClass, stepDoneDot, rowClass, stepIcon, stepStatusLabel,
            onFileChosen, clearBrief,
            onGeneratePlan,
            onApprovePlan, onOpenProject, onRetry, onClose,
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
    --aipg-primary: #4f46e5;
    --aipg-primary-hover: #4338ca;
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

.aipg-close-icon {
    width: 24px;
    height: 24px;
    cursor: pointer;
    transition: opacity 0.15s ease;
}
.aipg-close-icon:hover { opacity: 0.7; }
.aipg-close-icon-disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }

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
.aipg-step-line.done { background: #4f46e5; }
.aipg-step-active { color: #4f46e5; }
.aipg-step-active .aipg-step-dot {
    background: #eef2ff;
    color: #4f46e5;
    border-color: #4f46e5;
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
    border-color: #4f46e5;
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
    border-color: #4f46e5;
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
    border-color: #4f46e5;
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
.aipg-privacy-option-active .aipg-privacy-sub { color: #4338ca; }
.aipg-target-count {
    display: inline-block;
    margin-left: 8px;
    padding: 2px 10px;
    background: #eef2ff;
    color: #4f46e5;
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
    border-color: #4f46e5;
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
    border-color: #4f46e5;
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
    color: #4f46e5;
    cursor: pointer;
    padding: 0 4px;
    font: inherit;
    text-decoration: underline;
}
.aipg-btn-link:hover:not(:disabled) { color: #4338ca; }
.aipg-btn-link:disabled { color: #cbd5e1; cursor: not-allowed; text-decoration: none; }

/* ─────────────────────────────────────────────────────────────────────
   Clarification questions
   ───────────────────────────────────────────────────────────────────── */
.aipg-section-title {
    margin: 0 0 12px;
    font-size: 14px;
    font-weight: 600;
    color: #4f46e5;
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
.aipg-chip-app { background: #eef2ff; color: #4338ca; }

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
    flex: 0 1 auto;
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
    color: #4338ca;
}
.aipg-progress-row-active .aipg-progress-status { color: #4f46e5; }
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
    background: #4f46e5;
    color: #ffffff;
    border-color: #4f46e5;
}
.aipg-btn-primary:hover:not(:disabled) {
    background: #4338ca;
    border-color: #4338ca;
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
   Spinner
   ───────────────────────────────────────────────────────────────────── */
.aipg-spinner {
    display: inline-block;
    width: 18px;
    height: 18px;
    border: 2px solid rgba(79, 70, 229, 0.2);
    border-top-color: #4f46e5;
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
