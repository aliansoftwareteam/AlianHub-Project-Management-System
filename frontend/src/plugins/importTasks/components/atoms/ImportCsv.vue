<template>
	<div class="p-20px text-center">
		<!-- Download Demo CSV -->
		<h3 class="mb-20px">
			{{ $t('importCsvAndSetHeader.download') }} <span class="blue cursor-pointer text-decoration-underline"
				@click="downloadDemoCsv">{{ $t('importCsvAndSetHeader.demo_csv') }}</span>
			{{ $t('importCsvAndSetHeader.down_demo_text') }}
		</h3>

		<!-- Upload Area -->
		<div class="border-gray-bold-dashed bg-light-gray border-radius-8-px p-30px cursor-pointer d-flex flex-column align-items-center justify-center"
			@click="$refs.inputRef.click()">
			<img :src=uploadIcon alt="Upload" class="w-30px" />
			<p>{{ $t('importCsvAndSetHeader.upload_button') }}</p>
			<input type="file" ref="inputRef" @change="handleFileChange" accept=".csv" class="d-none" />
		</div>

		<!-- Instructions -->
		<p class="font-size-14 gray mt-20px">
			{{ $t('importCsvAndSetHeader.upload_instructions') }}
		</p>
	</div>
</template>


<script setup>
import { ref, inject, defineProps } from 'vue';
import { loadXlsx } from '@/utils/loadXlsx';
import demoCsv from '../demoCsv.json';
import demoUserCsv from '../demoUserCsv.json';
import { useToast } from 'vue-toast-notification';
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const $toast = useToast();
const uploadIcon = require("@/assets/images/svg/upload_icon.svg");
const exportTasks = inject("ExportTaskAsCsv");
const headers = ref([]);
const tableData = ref([]);
const isFileUpload = ref(false);
const emit = defineEmits(['update-data', 'next-step']);

const props = defineProps({
	fromImportUsers: {
		type: Boolean,
		required: false
	}
});

const handleFileChange = (event) => {
	const file = event.target.files[0];

	if (!file) return;

	if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
		$toast.error(t('Toast.invalid_file_error'), { position: 'top-right' });
		event.target.value = "";
		return;
	}

	const reader = new FileReader();
	reader.onload = async function (e) {
		const data = e.target.result;
		const XLSX = await loadXlsx().catch(() => null);
		if (!XLSX) {
			$toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
			return;
		}
		const workbook = XLSX.read(data, { type: 'binary', codepage: 65001 });
		const sheetName = workbook.SheetNames[0];
		const worksheet = workbook.Sheets[sheetName];
		const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

		isFileUpload.value = true;
		headers.value = jsonData.shift(); // Extract and remove the headers from jsonData

		// Replace empty fields in the data with "N/A"
		tableData.value = jsonData.map(row =>
			headers.value.map((_, index) => row[index] !== undefined && row[index] !== "" ? row[index] : "N/A")
		);

		emit('update-data', { headers: headers.value, tableData: tableData.value });

		// Emit an event to move to the next step in the workflow
		emit('next-step', { step: 1, auto: isFileUpload.value });
	};
	reader.readAsBinaryString(file);
};


// Function to handle demo CSV download
const downloadDemoCsv = () => {
	if (props?.fromImportUsers) {
		const fieldsToInclude = [
			"email",
			"role",
			"designation"
		]
		exportTasks({
			tasks: demoUserCsv,
			fieldsToInclude,
			fileName: "demoUserData.csv"
		});
	}
	else {
		const fieldsToInclude = [
			"taskName",
			"taskLeaderId",
			"taskPriority",
			"status",
			"description",
			"startDate",
			"dueDate"
		];
		exportTasks({
			tasks: demoCsv,
			fieldsToInclude,
			fileName: "demoTaskData.csv"
		});
	}
};

</script>