<template>
    <div>
        <Sidebar
            :title="$t('Category.edit_category')"
            :visible="visible"
            @update:visible="inProgress ? '' : $emit('update:visible', $event)"
            width="610px;"
        >
            <template #body>
                <div class="bg-light-gray h-100 p-10px">
                    <div class="position-ab d-flex align-items-center justify-content-center z-index-7 h-100 w-100 bg-dark-gray3" v-if="inProgress">
                        <Spinner :isSpinner="true"/>
                    </div>
                    <div class="bg-white border-radius-8-px p-15px webkit-avilable">
                        <!-- CATEGORY NAME -->
                        <div class="d-flex align-items-center">
                            <label class="text-nowrap mr-10px">{{$t('Category.cateory_name')}}<span class="red">*</span></label>
                            <div class="position-re w-100">
                                <input
                                    type="text"
                                    v-model.trim="categoryName.value"
                                    :placeholder="$t(`PlaceHolder.enter_category_name`)"
                                    class="form-control webkit-avilable"
                                    @keyup="checkErrors({
                                        'field': categoryName,
                                        'name': categoryName.name,
                                        'validations': categoryName.rules,
                                        'type': categoryName.type,
                                        'event': $event.event
                                    })"
                                >
                                <div class="red position-ab font-size-11 error__text-category" v-if="categoryName.error">{{categoryName.error}}</div>
                            </div>
                        </div>

                        <div class="d-flex justify-content-end mt-2">
                            <button class="btn-primary" @click="save()">{{$t('MainChat.save')}}</button>
                        </div>
                    </div>
                </div>
            </template>
        </Sidebar>
    </div>
</template>

<script setup>
/**
 * Rename a main-chat category.
 *
 * Uses the `editFolderName` handler the project folder list already goes through,
 * with `mainChat: true` so the project-history entry is skipped — the same split the
 * create-category flow makes.
 */
import { computed, defineProps, defineEmits, inject, ref, watch } from "vue";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";
import { useValidation } from "@/composable/Validation";
import { useGetterFunctions } from "@/composable";
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue";
import Spinner from "@/components/atom/SpinnerComp/SpinnerComp.vue";
import * as env from "@/config/env";
import { apiRequest } from "@/services";

const props = defineProps({
    visible: { type: Boolean, default: false },
    // The category (folder) being renamed.
    category: { type: Object, default: () => ({}) },
});

const emit = defineEmits(["update:visible", "saved"]);

const { t } = useI18n();
const { commit } = useStore();
const $toast = useToast();
const { checkAllFields, checkErrors } = useValidation();
const { getUser } = useGetterFunctions();

const projectData = inject("selectedProject");
const companyId = inject("$companyId");
const userId = inject("$userId");

const inProgress = ref(false);
const categoryName = ref({ error: "", value: "", rules: "required | min: 3", name: "category name" });

const categoryId = computed(() => {
    const category = props.category || {};
    return category.folderId || category._id || category.id || "";
});

/** Seed from the category when the panel opens; keyed on `visible` only, so a
 *  background refresh cannot reset the field mid-edit. */
watch(() => props.visible, (open) => {
    if (!open) return;
    categoryName.value = { ...categoryName.value, value: (props.category && props.category.name) || "", error: "" };
}, { immediate: true });

async function save() {
    if (inProgress.value) return;

    const valid = await checkAllFields({ categoryName: categoryName.value }).catch(() => false);
    if (!valid) return;

    const id = categoryId.value;
    if (!id) return;

    const user = getUser(userId.value) || {};

    inProgress.value = true;
    try {
        const response = await apiRequest("patch", `${env.FOLDER}/${id}`, {
            companyId: companyId.value,
            projectId: (projectData && projectData.value && projectData.value._id) || "",
            folderName: categoryName.value.value,
            prevFolderName: (props.category && props.category.name) || "",
            userData: {
                id: user.id,
                Employee_Name: user.Employee_Name,
                companyOwnerId: user.companyOwnerId,
            },
            projectName: (projectData && projectData.value && projectData.value.ProjectName) || "",
            mainChat: true,
            type: "editFolderName",
        });

        if (!response || !response.data || response.data.status !== true) {
            $toast.error((response && response.data && response.data.statusText) || t("Toast.something_went_wrong"), { position: "top-right" });
            return;
        }

        commit("mainChat/mutateChatFolders", { op: "modified", data: response.data.data });
        $toast.success(t("Toast.Category_updated_successfully"), { position: "top-right" });
        emit("saved", response.data.data);
        emit("update:visible", false);
    } catch (error) {
        console.error("ERROR in rename category: ", error);
        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
    } finally {
        inProgress.value = false;
    }
}
</script>

<style scoped>
.error__text-category {
    font-size: 11px;
    bottom: -14px;
    left: 0px;
}
.webkit-avilable {
    width: -webkit-fill-available;
    width: -moz-available;
    width: fill-available;
}
</style>
