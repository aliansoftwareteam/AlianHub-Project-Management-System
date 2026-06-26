<template>
    <!--
        AI Task Creator (AHE-3777) — generates sprints + tasks into an EXISTING
        project from the team's requirements, with a review-before-create step.
        Self-contained: pass `projectId` + v-model the visibility. Teleported to
        body so the overlay isn't trapped by the list's scroll/transform
        containers.
    -->
    <Teleport to="body">
        <div v-if="modelValue" class="aitc__overlay" @click.self="close()">
            <div class="aitc__modal">
                <!-- Header -->
                <div class="aitc__head">
                    <div class="aitc__head-left">
                        <span class="aitc__badge" aria-hidden="true">✨</span>
                        <div>
                            <div class="aitc__title">Plan with AI</div>
                            <div class="aitc__subtitle">Drafts the sprints and detailed tasks for this project from your requirements — you review before anything is created.</div>
                        </div>
                    </div>
                    <button class="aitc__close" @click="close()" aria-label="Close">&#10005;</button>
                </div>

                <!-- STEP: input -->
                <div v-if="step === 'input'" class="aitc__body">
                    <label class="aitc__field-label">What should this project include?</label>
                    <div class="aitc__textarea-wrap">
                        <textarea
                            v-model="requirements"
                            class="aitc__textarea"
                            rows="5"
                            placeholder="e.g. Build a customer onboarding flow — signup, email verification, profile setup, and a welcome dashboard. Node + Vue."
                        ></textarea>
                    </div>

                    <div class="aitc__chips">
                        <span class="aitc__chips-label">Try:</span>
                        <button type="button" class="aitc__chip" @click="requirements = 'Build a Shopify clothing store: home, collection, product, cart and checkout pages, plus store policies and theme setup.'">Shopify store</button>
                        <button type="button" class="aitc__chip" @click="requirements = 'Mobile app MVP: onboarding, signup/login, home feed, profile and settings — design + build per screen, with the supporting API endpoints.'">Mobile app MVP</button>
                        <button type="button" class="aitc__chip" @click="requirements = 'REST API for a tasks service: auth endpoints and full CRUD for tasks and projects, with validation and tests.'">REST API</button>
                        <button type="button" class="aitc__chip" @click="requirements = 'Marketing launch campaign: landing page, email sequence, social content calendar and analytics setup.'">Marketing campaign</button>
                    </div>

                    <div v-if="error" class="aitc__error">{{ error }}</div>

                    <div class="aitc__actions">
                        <button class="aitc__btn aitc__btn--ghost" @click="close()">Cancel</button>
                        <button class="aitc__btn aitc__btn--ai" :disabled="requirements.trim().length < 3" @click="generate()">
                            <span aria-hidden="true">✨</span> Generate plan
                        </button>
                    </div>
                </div>

                <!-- STEP: generating -->
                <div v-else-if="step === 'generating'" class="aitc__body aitc__center">
                    <div class="aitc__orb" aria-hidden="true"></div>
                    <p class="aitc__status">{{ progressMsg || 'Generating plan…' }}</p>
                    <p class="aitc__sub">This can take up to a minute for a detailed plan.</p>
                </div>

                <!-- STEP: preview -->
                <div v-else-if="step === 'preview'" class="aitc__body">
                    <div class="aitc__preview-head">
                        <span class="aitc__preview-hint">Review the plan — uncheck anything you don't want.</span>
                        <span class="aitc__selected-pill">{{ selectedCount }} selected</span>
                    </div>
                    <div class="aitc__plan style-scroll">
                        <div v-for="(sprint, si) in plan.sprints" :key="si" class="aitc__sprint">
                            <div class="aitc__sprint-name">
                                <span>{{ sprint.sprintName }}</span>
                                <span class="aitc__count">{{ sprint.tasks.length }}</span>
                            </div>
                            <label v-for="(task, ti) in sprint.tasks" :key="ti" class="aitc__task" :class="{ 'aitc__task--off': !task.__selected }">
                                <input type="checkbox" v-model="task.__selected" />
                                <span class="aitc__task-name" :title="task.TaskName">{{ task.TaskName }}</span>
                                <span class="aitc__pri" :class="`aitc__pri--${String(task.priority || 'Medium').toLowerCase()}`">{{ task.priority || 'Medium' }}</span>
                            </label>
                        </div>
                    </div>
                    <div v-if="error" class="aitc__error">{{ error }}</div>
                    <div class="aitc__actions">
                        <button class="aitc__btn aitc__btn--ghost" @click="step = 'input'">Back</button>
                        <button class="aitc__btn aitc__btn--ai" :disabled="selectedCount === 0" @click="create()">Create {{ selectedCount }} task{{ selectedCount === 1 ? '' : 's' }}</button>
                    </div>
                </div>

                <!-- STEP: creating -->
                <div v-else-if="step === 'creating'" class="aitc__body aitc__center">
                    <div class="aitc__orb" aria-hidden="true"></div>
                    <p class="aitc__status">{{ progressMsg || 'Creating your plan…' }}</p>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { ref, computed, defineProps, defineEmits } from 'vue';
import { useToast } from 'vue-toast-notification';
import { useAiTaskGenerator } from '@/composable/aiTaskGenerator';

const props = defineProps({
    modelValue: { type: Boolean, default: false },
    projectId: { type: String, required: true },
});
const emit = defineEmits(['update:modelValue', 'done']);

const $toast = useToast();
const { generateTasks, executeTasks, subscribeToProgress } = useAiTaskGenerator();

const step = ref('input');          // input | generating | preview | creating
const requirements = ref('');
const plan = ref({ sprints: [] });
const progressMsg = ref('');
const error = ref('');

const selectedCount = computed(() => {
    let n = 0;
    for (const s of (plan.value.sprints || [])) {
        for (const t of (s.tasks || [])) if (t.__selected) n += 1;
    }
    return n;
});

function reset() {
    step.value = 'input';
    requirements.value = '';
    plan.value = { sprints: [] };
    progressMsg.value = '';
    error.value = '';
}

function close() {
    // Don't allow closing mid-flight so we don't orphan an in-progress run.
    if (step.value === 'generating' || step.value === 'creating') return;
    reset();
    emit('update:modelValue', false);
}

async function generate() {
    if (requirements.value.trim().length < 3) return;
    error.value = '';
    progressMsg.value = 'Generating plan…';
    step.value = 'generating';
    try {
        const res = await generateTasks(props.projectId, { additionalRequirements: requirements.value.trim() });
        const p = res && res.plan;
        if (!p || !Array.isArray(p.sprints) || !p.sprints.length) {
            throw new Error('The AI did not return any tasks. Try rephrasing your requirements.');
        }
        for (const s of p.sprints) {
            for (const t of (s.tasks || [])) t.__selected = true;
        }
        plan.value = p;
        step.value = 'preview';
    } catch (e) {
        error.value = (e && e.message) || 'Task generation failed. Please try again.';
        step.value = 'input';
    }
}

// Build a clean plan with only the checked tasks (and only sprints that
// still have tasks). Strips the UI-only __selected flag.
function buildSelectedPlan() {
    const sprints = [];
    for (const s of (plan.value.sprints || [])) {
        const tasks = (s.tasks || [])
            .filter((t) => t.__selected)
            .map((t) => { const rest = { ...t }; delete rest.__selected; return rest; });
        if (tasks.length) sprints.push({ sprintName: s.sprintName, tasks });
    }
    return { sprints };
}

async function create() {
    const payload = buildSelectedPlan();
    if (!payload.sprints.length) return;
    error.value = '';
    progressMsg.value = 'Creating your plan…';
    step.value = 'creating';
    try {
        const res = await executeTasks(props.projectId, { plan: payload });
        if (!res || !res.status || !res.jobId) {
            throw new Error((res && res.statusText) || 'Could not start task creation.');
        }
        subscribeToProgress(res.jobId, (raw) => {
            let pl = raw;
            if (pl && pl.data) pl = pl.data;
            if (!pl) return;
            if (pl.event === 'progress') {
                if (pl.step === 'sprint') progressMsg.value = 'Creating sprints…';
                else if (pl.step === 'tasks') progressMsg.value = `Creating tasks… ${pl.completed || 0}/${pl.total || 0}`;
            } else if (pl.event === 'complete') {
                const totals = pl.totals || {};
                $toast.success(`Created ${totals.tasks || 0} task${totals.tasks === 1 ? '' : 's'} in ${totals.sprints || 0} sprint${totals.sprints === 1 ? '' : 's'} with AI`, { position: 'top-right' });
                emit('done', totals);
                reset();
                emit('update:modelValue', false);
            } else if (pl.event === 'error') {
                error.value = pl.error || 'Task creation failed. Please try again.';
                step.value = 'preview';
            }
        });
    } catch (e) {
        error.value = (e && e.message) || 'Task creation failed. Please try again.';
        step.value = 'preview';
    }
}
</script>

<style scoped>
.aitc__overlay {
    position: fixed;
    inset: 0;
    /* Teleported to <body>, outside #app — so the app's `#app { font-family: 'Roboto' }`
       doesn't reach it and text falls back to the browser serif. Set it explicitly. */
    font-family: 'Roboto', sans-serif;
    background: rgba(20, 22, 40, 0.55);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1200;
    padding: 16px;
}
.aitc__modal {
    background: #fff;
    color: #1c2434;
    border-radius: 16px;
    width: min(580px, 96vw);
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    padding: 22px 24px 20px;
    box-shadow: 0 24px 60px rgba(28, 26, 80, 0.28);
}

/* Header */
.aitc__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.aitc__head-left { display: flex; align-items: flex-start; gap: 12px; }
.aitc__badge {
    flex: 0 0 auto;
    width: 38px; height: 38px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 11px;
    font-size: 18px;
    background: linear-gradient(135deg, #7C5CFF 0%, #4D7CFF 55%, #C44BFF 100%);
    box-shadow: 0 6px 16px rgba(108, 99, 255, 0.35);
}
.aitc__title { font-size: 17px; font-weight: 700; line-height: 1.2; }
.aitc__subtitle { font-size: 12.5px; color: #6b7488; margin-top: 3px; line-height: 1.5; max-width: 430px; }
.aitc__close {
    flex: 0 0 auto; border: none; background: transparent; cursor: pointer;
    color: #9aa1b1; font-size: 15px; width: 28px; height: 28px; border-radius: 8px;
    transition: background 0.15s, color 0.15s;
}
.aitc__close:hover { background: #f1f2f6; color: #e8556b; }

/* Body */
.aitc__body { display: flex; flex-direction: column; min-height: 0; }
.aitc__center { align-items: center; justify-content: center; padding: 42px 0; text-align: center; }
.aitc__field-label { font-size: 13px; font-weight: 600; color: #3a4255; margin-bottom: 8px; }

/* Textarea with gradient focus ring */
.aitc__textarea-wrap {
    border-radius: 12px;
    padding: 1.5px;
    background: #e6e8ef;
    transition: background 0.2s, box-shadow 0.2s;
}
.aitc__textarea-wrap:focus-within {
    background: linear-gradient(120deg, #7C5CFF, #4D7CFF, #C44BFF);
    box-shadow: 0 0 0 4px rgba(124, 92, 255, 0.14);
}
.aitc__textarea {
    width: 100%; box-sizing: border-box;
    border: none; outline: none;
    border-radius: 11px;
    padding: 13px 14px;
    font-size: 14px; line-height: 1.55;
    resize: vertical; min-height: 112px;
    font-family: inherit; color: #1c2434;
    background: #fff;
}
.aitc__textarea::placeholder { color: #aab0bf; }

/* Quick-start chips */
.aitc__chips { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 12px; }
.aitc__chips-label { font-size: 12px; color: #8a92a4; margin-right: 2px; }
.aitc__chip {
    border: 1px solid #e3e6ef; background: #f7f8fb; color: #4a5266;
    font-size: 12px; font-weight: 500;
    border-radius: 999px; padding: 5px 12px; cursor: pointer;
    transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.aitc__chip:hover { border-color: #7C5CFF; color: #6a5cff; background: #f3f1ff; }

/* Error */
.aitc__error {
    font-size: 13px; color: #c0392b; background: #fdecec;
    border-radius: 8px; padding: 9px 12px; margin-top: 14px;
}

/* Actions + buttons */
.aitc__actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.aitc__btn {
    height: 38px; padding: 0 18px; border-radius: 10px;
    font-size: 13.5px; font-weight: 600; cursor: pointer;
    display: inline-flex; align-items: center; gap: 6px;
    border: 1px solid transparent; transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s;
}
.aitc__btn--ghost { background: #fff; border-color: #dfe2ea; color: #4a5266; }
.aitc__btn--ghost:hover { background: #f5f6f9; }
.aitc__btn--ai {
    color: #fff;
    background: linear-gradient(120deg, #7C5CFF 0%, #4D7CFF 55%, #C44BFF 100%);
    box-shadow: 0 6px 16px rgba(108, 99, 255, 0.32);
}
.aitc__btn--ai:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 9px 22px rgba(124, 92, 255, 0.4); }
.aitc__btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Preview */
.aitc__preview-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.aitc__preview-hint { font-size: 13px; color: #6b7488; }
.aitc__selected-pill { font-size: 12px; font-weight: 600; color: #6a5cff; background: #f3f1ff; border-radius: 999px; padding: 3px 11px; }
.aitc__plan { overflow-y: auto; max-height: 48vh; border: 1px solid #ecedf3; border-radius: 12px; padding: 6px; }
.aitc__sprint { margin-bottom: 6px; }
.aitc__sprint-name {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; font-weight: 700; color: #1c2434;
    padding: 8px 8px 6px; position: sticky; top: 0; background: #fff;
}
.aitc__count { font-size: 11px; font-weight: 600; color: #6a5cff; background: #f3f1ff; border-radius: 999px; padding: 1px 8px; }
.aitc__task {
    display: flex; align-items: center; gap: 9px;
    padding: 7px 9px; border-radius: 9px; font-size: 13px; cursor: pointer;
    transition: background 0.12s, opacity 0.12s;
}
.aitc__task:hover { background: #f6f7fb; }
.aitc__task--off { opacity: 0.5; }
.aitc__task input { accent-color: #6a5cff; width: 15px; height: 15px; flex: 0 0 auto; }
.aitc__task-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #2b3346; }
.aitc__pri { flex: 0 0 auto; font-size: 11px; font-weight: 600; border-radius: 999px; padding: 2px 9px; }
.aitc__pri--high { background: #fdeaea; color: #c0392b; }
.aitc__pri--medium { background: #eef0fb; color: #3a55b0; }
.aitc__pri--low { background: #eef0f3; color: #6b7488; }

/* Loading ring (gradient) */
.aitc__orb {
    width: 52px; height: 52px; border-radius: 50%;
    margin-bottom: 16px;
    background: conic-gradient(from 0deg, #7C5CFF, #4D7CFF, #C44BFF, #7C5CFF);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px));
    animation: aitc-spin 1.1s linear infinite;
}
.aitc__status { font-size: 14px; font-weight: 600; color: #2b3346; margin: 0; }
.aitc__sub { font-size: 12px; color: #97a0af; margin: 8px 0 0; }
@keyframes aitc-spin { to { transform: rotate(360deg); } }
</style>
