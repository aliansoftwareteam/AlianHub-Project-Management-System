<template>
	<div class="sfi">
		<div class="sfi__row">
			<input
				:id="id"
				type="text"
				class="ah-input sfi__input"
				:class="{ 'ah-input--error': listName.error }"
				v-model.trim="listName.value"
				:placeholder="placeholder"
				:aria-label="placeholder"
				:aria-invalid="Boolean(listName.error)"
				:aria-describedby="listName.error ? `${id}-error` : null"
				@keypress.enter="submit"
				@keydown.esc.stop="$emit('cancel')"
				@keyup="checkErrors({'field':listName,
				'name':listName.name,
				'validations':listName.rules,
				'type':listName.type,
				'event':$event.event})"
				:disabled="inProgress"
			>
			<template v-if="!dialog">
				<button type="button" class="sfi__btn sfi__btn--save" :title="$t('Projects.save')" :aria-label="$t('Projects.save')" :disabled="inProgress" @click.stop="submit">
					<ShellIcon name="check" :size="16" />
				</button>
				<button type="button" class="sfi__btn" :title="$t('Projects.cancel')" :aria-label="$t('Projects.cancel')" @click.stop="$emit('cancel')">
					<ShellIcon name="x" :size="16" />
				</button>
			</template>
		</div>
		<div v-if="listName.error" :id="`${id}-error`" class="ah-field__error sfi__error">{{listName.error}}</div>
		<div v-if="dialog" class="sfi__actions">
			<button type="button" class="ah-btn ah-btn--secondary" @click.stop="$emit('cancel')">{{ $t('Projects.cancel') }}</button>
			<button type="button" class="ah-btn ah-btn--primary" :disabled="inProgress || !listName.value" @click.stop="submit">{{ $t('Projects.create') }}</button>
		</div>
	</div>
</template>

<script setup>
// PACKAGE
import { ref, computed, defineEmits, defineProps, inject, onMounted, nextTick } from "vue";
import { useStore } from "vuex";
import { useCustomComposable } from "@/composable";
import { useValidation } from "@/composable/Validation";
import * as env from '@/config/env';
import { useToast } from "vue-toast-notification";
import { apiRequest } from '../../../services';
import { dbCollections } from "../../../utils/Collections";
import { sprintPlanPermission } from "@/composable/commonFunction";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
const { t } = useI18n();

// UTILS
const companyId = inject('$companyId');
const projectData = inject('selectedProject');
const {commit} = useStore();
const  { checkErrors , checkAllFields } = useValidation();
const {makeUniqueId} = useCustomComposable();
const $toast = useToast();
const { checkPerProjectSprintPermission } = sprintPlanPermission();

const emit = defineEmits(["cancel","updateData"]);
const id = makeUniqueId();

const props = defineProps({
	item: {
		type: Object,
		default: null
	},

	createFolder: {
		type: Boolean,
		default: true
	},
	createSprint: {
		type: Boolean,
		default: true
	},
	folder: {
		type: Object,
		default: null
	},
	subItems: {
		type: Array,
		default: () => []
	},
	parentFolderId: {
		type: String,
		default: ''
	},
	project: {
		type: Object,
		default: null
	},
	dialog: {
		type: Boolean,
		default: false
	}
})

/* A host that provides `selectedProject` cannot inject it, so it hands the project over. */
const folderProject = () => props.project || projectData?.value;

/* A folder entry carries its own id as `folderId` and its lists in `sprintsObj`; a list carries the id of the folder it is in. */
const isSiblingOfNewList = (x) => x.deletedStatusKey !== 1 && !x.sprintsObj && String(x?.folderId || '') === String(props.folder?.folderId || '');

const inProgress = ref(false);

const placeholder = computed(() => t(props.createSprint ? 'PlaceHolder.Enter_sprint_name' : 'PlaceHolder.Enter_directory_name'));
const submit = () => (props.createSprint ? createEditSprint() : createEditFolder());

const listName = ref({
	value: "",
	rules:
	"required | min: 3",
	name: "name",
	error: "",
});
onMounted(() => {
	listName.value.value = props.item ? props.item.name : "";

	nextTick(() => {
		document.getElementById(id).focus();
	})
})


// SPRINT OPERATIONS
function createEditSprint() {
	if(inProgress.value) {
		return
	}
	checkPerProjectSprintPermission(folderProject()._id,dbCollections.SPRINTS).then((result) => {
		if(result){
			if(listName?.value?.value?.length) {
				listName.value.value = listName.value.value.trim();
			}

			checkAllFields({listName: listName.value})
			.then((valid) => {
				if(valid) {
					inProgress.value = true;
		
					let sprintIndex = -1;
					if(props.item !== null) {
						if(listName.value.value === props.item.name.trim()) {
							$toast.success(t(`Toast.Nothing_to_update`), {position: "top-right"});
							inProgress.value = false;
							return;
						}
						sprintIndex = props.subItems.filter((x) => x.deletedStatusKey !== 1 && !x?.folderId).findIndex((x) => x.name?.toLowerCase() === listName.value.value.toLowerCase() && x.id !== props.item.id)
					} else {
						sprintIndex = props.subItems.filter(isSiblingOfNewList).findIndex((x) => x.name?.toLowerCase() === listName.value.value.toLowerCase())
					}
		
					if(sprintIndex !== -1) {
						$toast.error(t(`Toast.Sprint_already_exists`), {position: "top-right"});
						inProgress.value = false;
						return;
					}
		
					const axiosData = {
						companyId: companyId.value,
						projectId: folderProject()._id,
						sprintName: listName.value.value,
					}
		
					if(props.folder) {
						axiosData.folder = {
							folderId: props.folder.folderId,
							folderName: props.folder.folderName
						}
					} else {
						axiosData.folder = null
					}
		
					let endPoint = "";
					if(props.item !== null) {
						endPoint = env.SPRINT+"/"+props.item.id;
					} else {
						endPoint = env.SPRINT;
					}
					apiRequest(props.item !== null ? "patch" : "post", endPoint, {
							...axiosData,
							type: props.item !== null ? "editSprintName" : "addSprint",
					})
					.then((res) => {
						if(props.item !== null){
							commit("projectData/mutateSprints",{op:'modified',data:{...res?.data?.data}});
						}else{
							commit("projectData/mutateSprints",{op:'added',data:{...res?.data?.data}});
						}
						if(res?.data?.data) {
							emit("updateData",res?.data?.data,"Sprint");
						}
						if(res.data.status === true){
							$toast.success(t(`Toast.Sprint ${props.item !== null ? 'updated' : 'created'} successfully`), {position: "top-right"})
							emit('cancel');
							listName.value.value = "";
							listName.value.error = "";
						}else if(res.data.isUpgrade){
							$toast.error(t(`Toast.Upgrade_your_plan_you_have_reached_the_limit_for_creating_sprints`), {position: "top-right"});
						}else{
							$toast.error(t(`Toast.something_went_wrong`), {position: "top-right"});
						}
						inProgress.value = false;
					})
					.catch((err) => {
						inProgress.value = false;
						$toast.error(t(`Toast.something_went_wrong`), {position: "top-right"})
						emit('cancel');
						console.error("Error: ", err);
					})
				} else {
					inProgress.value = false;
				}
			})
			.catch((error) => {
				inProgress.value = false;
				console.error("ERROR in validation: ", error);
			})
		}else{
			$toast.error(t(`Toast.Upgrade_your_plan_you_have_reached_the_limit_for_creating_sprints`), {position: "top-right"});
		}
	});
}

// FOLDER OPERATIONS
function createEditFolder() {
	if(inProgress.value) {
		return;
	}
	if(!listName?.value?.value?.length) {
		listName.value.value = listName.value.value.trim();
	}

	checkAllFields({listName: listName.value})
	.then((valid) => {
		if(valid) {
			inProgress.value = true;
			let folderIndex = -1;
			if(props.item !== null) {
				if(listName.value.value === props.item.name.trim()) {
					$toast.success(t(`Toast.Nothing_to_update`), {position: "top-right"});
					inProgress.value = false;
					return;
				}
				folderIndex = props.subItems?.filter((y) => y.folderId && y.deletedStatusKey !== 1).findIndex((x) => x.name?.toLowerCase() === listName.value.value.toLowerCase() && x.folderId !== props.item.id)
			} else {
				folderIndex = props.subItems?.filter((y) => y.folderId && y.deletedStatusKey !== 1 && String(y.parentFolderId || '') === props.parentFolderId).findIndex((x) => x.name?.toLowerCase() === listName.value.value.toLowerCase())
			}

			if(folderIndex !== -1) {
				$toast.error(t(`Toast.Folder_already_exists`), {position: "top-right"});
				inProgress.value = false;
				return;
			}

			const axiosData = {
				companyId: companyId.value,
				projectId: folderProject()._id,
				folderName: listName.value.value,
				...(props.item === null && props.parentFolderId ? { parentFolderId: props.parentFolderId } : {}),
			}

			let endPoint = "";
			if(props.item !== null) {
				endPoint = env.FOLDER+"/"+props.item.id;
			} else {
				endPoint = env.FOLDER;
			}
			apiRequest(props.item !== null ? "patch" : "post", endPoint, {
					...axiosData,
					type: props.item !== null ? "editFolderName" : "addFolder",
			})
			.then((result) => {
				if(props.item !== null){
					commit("projectData/mutateFolders",{op:'modified',data:{...result?.data?.data}});
				}else{
					commit("projectData/mutateFolders",{op:'added',data:{...result?.data?.data}});
				}
				if(result?.data?.data) {
					emit("updateData",result?.data?.data,"Folder");
				}
				if(result.data.status){
					$toast.success(t(`Toast.Folder ${props.item !== null ? 'updated' : 'created'} successfully`), {position: "top-right"})
					emit('cancel');
					listName.value.value = "";
					listName.value.error = "";
				}else if(result.data.isUpgrade){
					$toast.error(t(`Toast.upgrade_plan_folder_limit_reached`), {position: "top-right"});
				}else{
					$toast.error(t(`Toast.something_went_wrong`), {position: "top-right"});
				}
				inProgress.value = false;
			})
			.catch((err) => {
				$toast.error(err?.response?.data?.statusText || t(`Toast.something_went_wrong`), {position: "top-right"})
				emit('cancel');
				inProgress.value = false;
				console.error("Error: ", err);
			})
		} else {
			inProgress.value = false;
		}
	})
	.catch((error) => {
		inProgress.value = false;
		console.error("ERROR in validation: ", error);
	})
}
</script>

<style scoped>
.sfi { width: 100%; min-width: 0; }
.sfi__row { display: flex; align-items: center; gap: var(--sp-2); }
.sfi__input { flex: 1; min-width: 0; }
.sfi__btn {
	flex: none; display: inline-flex; align-items: center; justify-content: center;
	width: var(--control-h); height: var(--control-h); min-width: var(--hit-min); min-height: var(--hit-min); padding: 0;
	border: 0; border-radius: var(--r-input); background: transparent; color: var(--ink-2); cursor: pointer;
}
.sfi__btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
.sfi__btn:focus-visible { outline: none; box-shadow: var(--focus); }
.sfi__btn:disabled { opacity: .55; cursor: not-allowed; }
.sfi__btn--save, .sfi__btn--save:hover:not(:disabled) { color: var(--brand); }
.sfi__error { margin-top: var(--sp-2); }
.sfi__actions { display: flex; justify-content: flex-end; gap: var(--sp-4); margin-top: var(--sp-8); }
</style>
