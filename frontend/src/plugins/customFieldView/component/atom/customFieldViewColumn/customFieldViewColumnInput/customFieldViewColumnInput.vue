<template>
    <div class="formkit__content-view-column">
        <InputField
            :type="props.type"
            :accept="props.accept"
            :options="props.options"
            :name="props.name"
            :help="props.help"
            :label="props.label"
            :placeholder="props.placeholder"
            :validations="props.validations"
            :validation-visibility="props.validationVisibility"
            @changeUpdate="(val) => emit('changeUpdate',val)"
            @inputUpdate="(val) => emit('inputUpdate',val)"
            @blurUpdate="(val,details,id) => emit('blurUpdate',val,details,id)"
            :className="props.className"
            :bindValue="props.bindValue"
            :detail="props.detail"
            :toopTipHover="false"
            :isFocus="true"
            @handleEdit="(val) => emit('handleEdit',val)"
            :customValidationMessage="customValidationMessage"
            :preventDefault="props.preventDefault"
            :isLabel="isLabel"
        />
    </div>
</template>

<script setup>
    import InputField from "@/components/atom/FormkitInput/InputField.vue";
    const emit = defineEmits(['blurUpdate','inputUpdate','changeUpdate','handleEdit']);
    const props = defineProps({
        label:{
            type: String,
            default:''
        },
        validations:{
            type: [Array,String],
            default:() =>[]
        },
        type:{
            type: String,
            default: "text"
        },
        placeholder:{
            type: String,
            default: ""
        },
        accept:{
            type: String,
            default: ""
        },
        inputValues:{
            type: Object,
            default:() => ({})
        },
        options:{
            type: Array,
            default:() => []
        },
        validationVisibility:{
            type: String,
            default:"blur"
        },
        help:{
            type: String,
            default:""
        },
        name:{
            type: String,
            default:""
        },
        bindValue:{
            type: [String,Array,Number,Boolean,Object],
            default: ''
        },
        detail:{
            type: Object,
            default: () => ({})
        },
        className:{
            type: String,
            default: ''
        },
        customValidationMessage:{
            type: Object,
            default: () => ({})
        },
        preventDefault:{
            type: Boolean,
            default: false
        },
        isLabel:{
            type: Boolean,
            default: false
        }
    });
</script>

<style scoped>
    @import './style.css';
</style>