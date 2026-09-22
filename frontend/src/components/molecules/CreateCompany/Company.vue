<template>
    <div class="p-1">
        <div class="style-scroll workSpaceSection companyWrapper">
            <div class="companyWrapper__content">
                <ul class="imageUplaod">
                    <li v-for="(item, index) in companies" :key="index" class="active">
                        <div>
                            <span v-if="!item.Cst_profileImage" class="no-img p-0">
                            {{ item.Cst_CompanyName.charAt(0).toUpperCase()}}
                            </span>
                            <span v-else class="p-0">
                            <img v-if="item.Cst_profileImage.includes('http')" :src="item.Cst_profileImage" alt="" class="companyimg">
                            <WasabiIamgeCompp v-else class="companyimg" :companyId="item._id" :data="{url:item.Cst_profileImage}"/>
                            </span>
                        </div>
                        <span class="black">{{ item.Cst_CompanyName }}</span>
                    </li>
                    <CreatecompnayinsideViewComponent @visibleClick="visibleClick" />
                    <SpinnerComp :is-spinner="isSpinner"/>
                </ul>
            </div>
            <!--//// Sidebar ////////// -->
            <CompanysidebarViewComponent
                @visibleClick="visibleClick"
                :visible="visible"
                @isSpinnerEvent="isSpinnerEvent"
                @companyProcess="companyProcess"
                @processMessage="processMessage"
            />
        </div>
    </div>
    <ProcessbarmodelViewComponent :isCompanyProcess="isCompanyProcess" :stepCompanyProcessMessage="stepCompanyProcessMessage" />
</template>

<script setup>

//components  
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import WasabiIamgeCompp from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import { showAlertModal } from '@/components/atom/AlertBox/helper';
import { useI18n } from "vue-i18n";
const { t } = useI18n();

// utility
import { defineComponent, ref,computed, inject} from "vue";
import { escapeHtml } from "@/utils/notificationHtml";
import * as env from '@/config/env';
import { apiRequestWithoutCompnay } from '@/services';
import { useStore } from "vuex";

defineComponent({
    name: "CompanyComponent",
    SpinnerComp
})

const {getters} = useStore();
const companies = computed(() => {
    return getters["settings/companies"];
})
const visible = ref(false);
const isSpinner = ref(false);
const isCompanyProcess = ref(false);
const stepCompanyProcessMessage = ref("");
const userId = inject("$userId")
const visibleClick = async (status) => {
    if(isSpinner.value === true) return;
    if (!status) {
        visible.value = false;
        return;
    }
    isSpinner.value = true;
    try {
        let { data } = await apiRequestWithoutCompnay("get", `${env.CHECK_FREE_COMPANY}/${userId.value}`, { userId: userId.value });

        if (data?.status) {
            visible.value = data.isFree;
            if (!data.isFree) {
                showAlertModal({
					title: t('Toast.free_company_limit_reached'),
					message: `${t('Company.freelimitreachedstart')} <strong>${escapeHtml((data?.companies || []).join(', '))}</strong> ${t('Company.freelimitreachedend')}`,
					type: 'info',
					showCancel: false,
					confirmButtonText: t("alertBox.ok"),
                    isHtml: true,
				})
            }
        } else {
            visible.value = status;
        }
        isSpinner.value = false;
    } catch (error) {
        isSpinner.value = false;
        console.error("API request failed:", error);
    }
}
const isSpinnerEvent = (status) => {
    isSpinner.value = status;
}

const companyProcess = (status) => {
    isCompanyProcess.value = status;
}
const processMessage = (message) => {
    stepCompanyProcessMessage.value = message;
}

</script>

<style scoped>
@import './style.css'
</style>