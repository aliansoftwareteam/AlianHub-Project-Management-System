<template>
    <div ref="anchor" class="rpt__export">
        <button
            type="button"
            class="ah-btn ah-btn--secondary ah-btn--sm"
            aria-haspopup="menu"
            :aria-expanded="open ? 'true' : 'false'"
            :disabled="disabled || busy"
            data-test="report-export"
            @click="open = !open"
        >
            <span v-if="busy" class="ah-spin" aria-hidden="true"></span>
            <ShellIcon v-else name="download" :size="13" aria-hidden="true" />
            {{ busy ? $t('Time.exporting') : $t('Time.export') }}
            <ShellIcon name="chevronDown" :size="12" aria-hidden="true" />
        </button>
        <div v-if="open" class="ah-pop rpt__export-pop" role="menu" :aria-label="$t('Reports.export_as')">
            <button
                v-for="format in FORMATS"
                :key="format.key"
                type="button"
                class="ah-pop__item"
                role="menuitem"
                :data-test="`report-export-${format.key}`"
                @click="choose(format.key)"
            >
                {{ $t(format.label) }}<small>.{{ format.key }}</small>
            </button>
            <template v-if="extra.length">
                <div class="ah-pop__sep"></div>
                <button
                    v-for="item in extra"
                    :key="item.key"
                    type="button"
                    class="ah-pop__item"
                    role="menuitem"
                    :data-test="`report-export-${item.key}`"
                    @click="choose(item.key)"
                >{{ item.label }}</button>
            </template>
        </div>
    </div>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';

defineOptions({ name: 'ReportExportMenu' });

const FORMATS = [
    { key: 'csv', label: 'Reports.format_csv' },
    { key: 'xlsx', label: 'Reports.format_xlsx' },
    { key: 'pdf', label: 'Reports.format_pdf' },
];

defineProps({
    busy: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    extra: { type: Array, default: () => [] },
});
const emit = defineEmits(['export']);

const anchor = ref(null);
const open = ref(false);

const choose = (format) => {
    open.value = false;
    emit('export', format);
};

const onOutside = (event) => { if (anchor.value && !anchor.value.contains(event.target)) open.value = false; };
const onEscape = (event) => { if (event.key === 'Escape') open.value = false; };
const listen = (on) => {
    document[on ? 'addEventListener' : 'removeEventListener']('click', onOutside);
    document[on ? 'addEventListener' : 'removeEventListener']('keydown', onEscape);
};
watch(open, listen);
onBeforeUnmount(() => listen(false));
</script>
