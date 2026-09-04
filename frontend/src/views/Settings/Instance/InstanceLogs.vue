<template>
    <div>
        <div class="in-actions">
            <div class="ah-tabs">
                <button v-for="k in kinds" :key="k" type="button" class="ah-tab" :class="{ 'is-active': kind === k }" @click="kind = k; load()">{{ $t(`InstanceV2.log_${k}`) }}</button>
            </div>
            <select v-model.number="lines" class="ah-input in-lines" @change="load">
                <option v-for="n in [200, 500, 2000]" :key="n" :value="n">{{ $t('InstanceV2.last_lines', { n }) }}</option>
            </select>
            <div class="ah-toolbar__spacer"></div>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="load">{{ $t('InstanceV2.refresh') }}</button>
            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy || !tail.file" @click="download(`${env.INSTANCE_LOG_DOWNLOAD}?name=${tail.file}`, tail.file)"><ShellIcon name="download" :size="14" />{{ $t('InstanceV2.download') }}</button>
        </div>
        <p class="ah-small">{{ tail.file ? $t('InstanceV2.log_reading', { file: tail.file, size: formatBytes(tail.size) }) : $t('InstanceV2.log_none') }} <a :href="guide('troubleshooting')" target="_blank" rel="noopener">{{ $t('InstanceV2.guide') }}</a></p>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <pre v-else class="in-pre">{{ tail.lines.length ? tail.lines.join('\n') : $t('InstanceV2.log_empty') }}</pre>

        <section v-if="files.length" class="ah-card in-card">
            <div class="in-card__head"><span class="in-card__title">{{ $t('InstanceV2.log_files') }}</span><span class="ah-small ah-mono">{{ dir }}</span></div>
            <table class="in-table">
                <thead><tr><th>{{ $t('InstanceV2.file') }}</th><th>{{ $t('InstanceV2.size') }}</th><th>{{ $t('InstanceV2.modified') }}</th><th></th></tr></thead>
                <tbody>
                    <tr v-for="f in files" :key="f.name">
                        <td class="ah-mono">{{ f.name }}</td><td>{{ formatBytes(f.size) }}</td><td>{{ formatWhen(f.modifiedAt) }}</td>
                        <td><button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="download(`${env.INSTANCE_LOG_DOWNLOAD}?name=${f.name}`, f.name)"><ShellIcon name="download" :size="14" /></button></td>
                    </tr>
                </tbody>
            </table>
        </section>
    </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useInstanceApi, formatBytes, formatWhen } from "./useInstanceApi";

defineOptions({ name: "InstanceLogs" });

const { get, download, message, guide, env } = useInstanceApi();
const kinds = ["error", "combined", "track"];
const kind = ref("error");
const lines = ref(500);
const tail = ref({ file: null, size: 0, lines: [] });
const files = ref([]);
const dir = ref("");
const busy = ref(false);
const error = ref("");

async function load() {
    busy.value = true;
    error.value = "";
    try {
        const [t, f] = await Promise.all([get(`${env.INSTANCE_LOGS}?file=${kind.value}&lines=${lines.value}`), get(env.INSTANCE_LOG_FILES)]);
        tail.value = t;
        files.value = f.files;
        dir.value = f.dir;
    } catch (e) {
        error.value = message(e);
    } finally {
        busy.value = false;
    }
}

onMounted(load);
</script>

<style scoped>
.in-lines { width: auto; height: 30px; padding: 0 8px; margin-left: 8px; }
</style>
