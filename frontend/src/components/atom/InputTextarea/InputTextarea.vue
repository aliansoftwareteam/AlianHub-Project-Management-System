<template>
    <textarea
        ref="field"
        class="form-control"
        :style="{ height: height, width: width , outline: !isOutline ? 'none' : '' }"
        :type="type"

        v-model="value"
        :id="inputId || null"
        :maxlength="maxLength"
        :placeHolder="placeHolder"
        :disabled="isDisabled"
        :readonly="isReadonly"

        @focus="$emit('focus', { value: value, isValid: isValid, event: $event })"
        @blur="$emit('blur', { value: value, isValid: isValid, event: $event })"

        @click="$emit('click', { value: value, isValid: isValid, event: $event })"
        @input="$emit('input', { value: value, isValid: isValid, event: $event })"

        @keypress.enter.prevent="$emit('enter' , { value: value, isValid: isValid, event: $event })"
        @keypress="$emit('keypress', { value: value, isValid: isValid, event: $event })"
        @keyup="$emit('keyup', { value: value, isValid: isValid, event: $event })"
        @keydown="$emit('keydown', { value: value, isValid: isValid, event: $event })"

        @mouseup="$emit('mouseup', { value: value, isValid: isValid, event: $event })"
        @mousedown="$emit('mousedown', { value: value, isValid: isValid, event: $event })"

    />
</template>

<script setup>
    import { computed, defineProps, defineEmits, onMounted, ref } from 'vue';

    const props = defineProps({
        inputId: {
            type: String,
            default: ''
        },
        type: {
            type: String,
            default: 'text'
        },
        modelValue: {
            type: String,
            default: ''
        },

        placeHolder: {
            type: String,
            default: 'Enter text'
        },

        maxLength: {
            type: Number,
            default: 250
        },
        minLength: {
            type: Number,
            default: 0
        },

        isDisabled: {
            type: Boolean,
            default: false
        },
        isReadonly: {
            type: Boolean,
            default: false
        },

        isDirectFocus: {
            type: Boolean,
            default: false
        },
        isRequired: {
            type: Boolean,
            default: false
        },

        height: {
            type: String,
            default: '30px'
        },
        width: {
            type: String,
            default: '100%'
        },
        isOutline: {
            type: Boolean,
            default: true
        }
    });

    const emit = defineEmits([
        'update:modelValue', 
        'blur',
        'focus', 
        'click', 
        'input', 
        'enter', 
        'keypress',
        'keyup',
        'keydown',
        'mouseup',
        'mousedown'
    ]);

    const isValid = computed(() => {
        if(!props.isRequired) {
            return true;
        } else  {
            return props.modelValue.length !== 0 && props.modelValue.length >= props.minLength && props.modelValue.length <= props.maxLength;
        }
    });

    const value = computed({
        get() {
            return props.modelValue
        },
        set(value) {
            emit('update:modelValue', value)
        }
    });

    const field = ref(null);
    onMounted(() => {
        if (props.isDirectFocus) field.value?.focus();
    });
</script>
<style>
</style>