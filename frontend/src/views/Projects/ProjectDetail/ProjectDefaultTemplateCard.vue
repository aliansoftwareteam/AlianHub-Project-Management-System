<template>
    <section class="pdt" :aria-labelledby="ids.heading">
        <h5 :id="ids.heading" class="pdt__title">{{ $t('TaskTemplates.default_title') }}</h5>
        <p :id="ids.hint" class="pdt__hint">{{ $t('TaskTemplates.default_hint') }}</p>
        <select
            v-model="selected"
            class="pdt__select"
            data-field="default-template"
            :aria-labelledby="ids.heading"
            :aria-describedby="ids.hint"
            :disabled="busy || loading"
            @change="save"
        >
            <option value="">{{ $t('TaskTemplates.default_none') }}</option>
            <option v-for="template in templates" :key="template._id" :value="template._id">{{ template.name }}</option>
        </select>
        <p v-if="!loading && !templates.length" class="pdt__hint">{{ $t('TaskTemplates.default_empty') }}</p>
        <p v-if="error" class="pdt__error" role="alert">{{ error }}</p>
    </section>
</template>

<script setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { defaultTemplateOf, errorText, listTemplates, setDefaultTemplate } from "@/components/molecules/TaskTemplates/taskTemplates";

defineOptions({ name: "ProjectDefaultTemplateCard" });

const props = defineProps({
    projectId: { type: String, required: true }
});

const { t } = useI18n();
const $toast = useToast();

const uid = `pdt-${Math.random().toString(36).slice(2, 8)}`;
const ids = { heading: `${uid}-heading`, hint: `${uid}-hint` };

const templates = ref([]);
const selected = ref("");
const saved = ref("");
const loading = ref(false);
const busy = ref(false);
const error = ref("");

function load(pid) {
    loading.value = true;
    error.value = "";
    listTemplates(pid)
        .then((list) => {
            if (pid !== props.projectId) return;
            templates.value = list;
            selected.value = defaultTemplateOf(list)?._id || "";
            saved.value = selected.value;
        })
        .catch((e) => { error.value = errorText(e, t("TaskTemplates.load_failed")); })
        .finally(() => { loading.value = false; });
}

watch(() => props.projectId, (pid) => { if (pid) load(pid); }, { immediate: true });

async function save() {
    busy.value = true;
    error.value = "";
    try {
        await setDefaultTemplate(props.projectId, selected.value);
        saved.value = selected.value;
        $toast.success(selected.value ? t("TaskTemplates.default_saved") : t("TaskTemplates.default_cleared"), { position: "top-right" });
    } catch (e) {
        selected.value = saved.value;
        error.value = errorText(e, t("TaskTemplates.default_failed"));
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped>
.pdt { display: flex; flex-direction: column; gap: 6px; margin: 20px 0 0; max-width: 420px; }
.pdt__title { margin: 0; font: 600 14px/1.3 var(--font-ui); color: var(--ink); }
.pdt__hint { margin: 0; color: var(--ink-2); font-size: 12px; }
.pdt__error { margin: 0; color: var(--danger); font-size: 12px; }
.pdt__select {
    box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--border); border-radius: var(--r-input, 8px);
    padding: 7px 8px; background: var(--surface); color: var(--ink); font: 400 12.5px/1.3 var(--font-ui);
}
.pdt__select:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
</style>
