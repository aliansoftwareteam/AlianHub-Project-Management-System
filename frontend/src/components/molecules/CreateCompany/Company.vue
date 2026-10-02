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
                        <span class="company-name">{{ item.Cst_CompanyName }}</span>
                    </li>
                </ul>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "vuex";
import WasabiIamgeCompp from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";

defineOptions({ name: "CompanyComponent" });

const { getters } = useStore();
const companies = computed(() => getters["settings/companies"]);
</script>

<style scoped>
@import './style.css'
</style>
