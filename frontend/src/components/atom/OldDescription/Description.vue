<template>
    <div class="description-wrapper mobile__bg--withPadding">
        <div class="d-flex align-items-center justify-content-between description-padding">
            <h4 class="task-details-subtitle black" :class="{'font-size-16 font-weight-600' : clientWidth <=767 , 'font-size-14 font-weight-700' : clientWidth > 767 }" >Description</h4>
            <p class="blue cursor-pointer font-size-16 font-weight-700 m-0" v-if="clientWidth <=767" @click="editPermission === true ? toggleDescriptionEdit() : ''">Edit</p>
        </div>
        <div class="description-main">
            <div>
                <div 
                    v-if="!isDescriptionEdit" 
                    @click="clientWidth > 767 && editPermission === true ? toggleDescriptionEdit() : '' " 
                    class="description__Edit-wrapper d-block"
                >
                    <div v-if="description">
                        <span class="ql-editor" v-if="description!== ''" v-html="sanitizeHtml(description)"></span>
                    </div>
                    <span v-else class="task-detail-subdesc">Add a Description...</span>
                </div>
                <div v-else>
                    <div>
                        <VueEditor
                            :editorToolbar="customToolbar"
                            class="description-editor"
                            name="description"
                            @text-change="checkDescription()"
                            placeholder="Add description..."
                            v-model="editorDescription"
                            ref="editor"
                            @keypress.enter.prevent="saveDescription()"
                            @paste="disablePaste"
                        />
                    </div>
                    <div>
                        <span v-if="desriptionError" class="red">{{ desriptionError }}</span>
                    </div>
                </div>
            </div>
        </div>
        <div class="description-action mt-10px mb-15px description-padding" v-if="isDescriptionEdit">
            <button
                class="outline-primary mr-10px"
                @click="toggleDescriptionEdit()"
            >
                Cancel
            </button>
            <button
                class="btn-primary"
                @click="saveDescription()"
            >
                Save
            </button>
        </div>
    </div>
</template>

<script setup>
import { defineComponent, defineEmits, defineProps, ref , inject} from "vue";

import { VueEditor } from "vue3-editor";
import { sanitizeHtml } from "@/utils/sanitizeHtml";

defineComponent({
    name: "DescriptionComponent"
});

const props = defineProps({
    description: {
        type: [String, Object],
        default: () => {}
    },
    editPermission: {
        type: [Boolean, Number],
        default: false
    },
    minlength: {
        type: Number,
        default: 0
    }
});

const emit = defineEmits(["update:description"]);

const isDescriptionEdit = ref(false);
const editorDescription = ref("");
const desriptionError = ref("");
const editor = ref(null);
const clientWidth = inject("$clientWidth");

const customToolbar = [
    [{ header: [false, 1, 2, 3, 4, 5, 6] }],
    ["bold", "italic", "underline", "strike"], // toggled buttons
    [
        { align: "" },
        { align: "center" },
        { align: "right" },
        { align: "justify" }
    ],
    ["blockquote", "code-block"],
    [{ list: "ordered" }, { list: "bullet" }, { list: "check" }],
    [{ indent: "-1" }, { indent: "+1" }], // outdent/indent
    [{ color: [] }, { background: [] }], // dropdown with defaults from theme
    ["link"]
]

const toggleDescriptionEdit = () => {
    isDescriptionEdit.value = !isDescriptionEdit.value;
    if(isDescriptionEdit.value) {
        editorDescription.value = props.description && props.description.text ? props.description.text : props.description;
    } else {
        editorDescription.value = "";
    }
    desriptionError.value = '';
}

const checkDescription = () => {
    const text = editorDescription.value.replace(/<[^>]*>/g, "")
    if(text.trim() === '') {
        editorDescription.value = '';
    } else {
        desriptionError.value = "";
    }
}

const saveDescription = () => {
    if(desriptionError.value || editorDescription.value === undefined) return;
    if(props.description || editorDescription.value !== ''){
        const text = editorDescription.value.replace(/<[^>]*>/g, "");
    
        const description = {
            text,
            html: editorDescription.value
        }
    
        emit("update:description", description);
    }
    toggleDescriptionEdit();
}

function disablePaste(e) {
    if(e.clipboardData.items?.[0].kind === "file") {
        e.preventDefault();
    }
}
</script>
<style src="./style.css">
</style>