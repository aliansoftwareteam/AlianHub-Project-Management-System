<template>
    <div
        @dragover.prevent="handleDragOver" 
        @drop.prevent="handleDrop" 
        @dragleave.prevent="handleDragLeave"
        class="upload-body-dragged font-weight-500"
    >
    {{$t('Attachments.drop_here')}}
    </div>
</template>

<script setup>
    import { useCustomComposable } from '@/composable';
    import { ref, defineProps } from 'vue';
    import { useToast } from "vue-toast-notification";
    import { useStore } from 'vuex';
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();
    
    const props = defineProps({
        extensions: {
            type: Array,
        },
    });

    // eslint-disable-next-line
    const extensions = ref("");
    const $toast = useToast();
    extensions.value = props.extensions.map(exe => exe.name).join();
    const statusOfDragAndDrop = ref({over: false, dropped: false,notDrop:false},)
    const emit =  defineEmits(["handleDrop","dragOver","dragLeave"]);
    const {checkBucketStorage} = useCustomComposable();
    const {getters} = useStore();

    //after drag and drop file upload function called
    const handleDrop = (event) => {
        emit("dragLeave",false);
        event.preventDefault();
        statusOfDragAndDrop.value.dropped = true;
        statusOfDragAndDrop.value.over = false;
        let arr = [];
        let isErrorInUpload = false;
        props.extensions.forEach((v) =>
            arr.push(v.name.replaceAll(" ", "_").toLowerCase())
        );
        let files = [];

        event.dataTransfer.items.forEach((ele)=>{ files.push(ele.getAsFile())});
        if(checkBucketStorage(files.map(file => file?.size),{gettersVal: getters}) !== true){
            return;
        }

        files = files.filter((x) => x);
        files.forEach((file) => {
            if(file == null) {
                isErrorInUpload = true;
                $toast.error(t("Toast.Please_select_valid_file"),{position: 'top-right'});
                return;
            }
            let fileName = file.name;
            var ele = fileName.substring(fileName.lastIndexOf(".") + 1);

            const isExists = arr.includes("." + ele.toLowerCase());
            if (!isExists) {
                isErrorInUpload = true;
                if(props.extensions.length > 1) {
                    $toast.error(t("Toast.require_image_format_message").replace('IMAGE_FORMAT', extensions.value),{position: 'top-right'});
                } else {
                    $toast.error(t("Toast.You_have_to_add_extension_in_setting"),{position: 'top-right'});
                }
                return;
            }
        });

        if(!isErrorInUpload) {
            emit("handleDrop", files);
        }
    }

    //when files dgrag over the main div for add some css to main div
    const handleDragOver = () => {
        emit("dragOver",true)
        statusOfDragAndDrop.value.over = true;
    }

    //when drag file remove from drag area class disable
    const handleDragLeave = () => {
        statusOfDragAndDrop.value.over = false;
        emit("dragLeave",false);
    }
</script>
<style>
.upload-body-dragged {
    background-color: color-mix(in srgb, var(--surface) 84%, transparent);
    border: 2px dashed;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99 !important;
    font-size: 18px;
}
</style>
