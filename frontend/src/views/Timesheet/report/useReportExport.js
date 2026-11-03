import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { downloadExport } from '@/composable/exportDownload';
import { tableOf, fileNameOf, filterLines } from './reportTable';

/* Sends the table on screen to the shared export routes (Modules/Export), so the file is what the filters show. */
export function useReportExport(labelOf = (field, value) => value) {
    const { t } = useI18n();
    const exporting = ref(false);
    const failed = ref(false);

    const lineOf = (field, value) => {
        if (field === 'range') return t('Reports.meta_range', { range: value });
        if (field === 'billable') return t('Reports.meta_billable', { value: t(value === 'billable' ? 'Time.billable' : 'Time.non_billable') });
        return t('Reports.meta_filter', { label: t(`Reports.filter_${field}`), values: value.map((item) => labelOf(field, item)).join(', ') });
    };

    /* report: { name, title, filters, columns, rows, total?, sheetName? } */
    const exportReport = async (format, report) => {
        if (exporting.value) return;
        exporting.value = true;
        failed.value = false;
        try {
            const range = report.filters ? { start: report.filters.start, end: report.filters.end } : null;
            await downloadExport(format, {
                ...tableOf(report),
                filename: fileNameOf(report.name, range),
                sheetName: report.sheetName || report.title,
                title: report.title,
                meta: report.filters ? filterLines(report.filters, lineOf) : [],
            });
        } catch (error) {
            failed.value = true;
        } finally {
            exporting.value = false;
        }
    };

    return { exporting, failed, exportReport };
}
