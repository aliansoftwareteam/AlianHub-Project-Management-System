<template>
    <div class="ff">
        <template v-if="type.widget === 'info'">
            <span class="ff__label">{{ question.label }}</span>
            <div v-if="question.help" class="ff__info">{{ question.help }}</div>
        </template>

        <template v-else>
            <label class="ff__label">
                {{ question.label }}<span v-if="question.required" class="ff__req">*</span>
                <span v-if="question.help" class="ff__help">{{ question.help }}</span>
            </label>

            <select v-if="type.widget === 'select'" v-model="answer" class="ff__input" :disabled="!live">
                <option value="">{{ $t('Projects.form_select_option') }}</option>
                <option v-for="o in options" :key="o.id" :value="o.label">{{ o.label }}</option>
            </select>

            <div v-else-if="type.widget === 'radio'" class="ff__choices">
                <label v-for="o in options" :key="o.id" class="ff__choice">
                    <input v-model="answer" type="radio" :value="o.label" :name="question.id" :disabled="!live">
                    <span>{{ o.label }}</span>
                </label>
            </div>

            <div v-else-if="type.widget === 'checkboxes'" class="ff__choices">
                <label v-for="o in options" :key="o.id" class="ff__choice">
                    <input v-model="multi" type="checkbox" :value="o.label" :disabled="!live">
                    <span>{{ o.label }}</span>
                </label>
            </div>

            <div v-else-if="type.widget === 'rating'" class="ff__stars">
                <span v-for="n in stars" :key="n" class="ff__star" :class="{ 'is-on': Number(answer) >= n }"
                    @click="live && (answer = n)">&#9733;</span>
            </div>

            <input v-else-if="type.widget === 'range'" v-model="answer" class="ff__range" type="range"
                min="0" max="100" step="5" :disabled="!live">

            <div v-else-if="type.widget === 'file'" class="ff__drop">
                {{ $t('Projects.form_drop_hint') }}
            </div>

            <div v-else-if="type.widget === 'money'" class="ff__money">
                <span class="ff__sym">$</span>
                <input v-model="answer" class="ff__input" type="number" step="0.01" :disabled="!live">
            </div>

            <textarea v-else-if="type.widget === 'textarea'" v-model="answer" class="ff__input ff__area"
                :placeholder="$t('Projects.form_enter_text')" :disabled="!live"></textarea>

            <input v-else v-model="answer" class="ff__input" :type="htmlType"
                :placeholder="placeholder" :disabled="!live">
        </template>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const props = defineProps({
    question: { type: Object, required: true },
    // The catalogue entry for this question's type, as served by the backend, so
    // the builder never keeps its own copy of what a type looks like.
    type: { type: Object, default: () => ({ widget: 'text' }) },
    // false on the Build canvas: the widget is shown but not usable, so clicking
    // a field selects the question instead of answering it.
    live: { type: Boolean, default: false },
});

const answer = ref('');
const multi = ref([]);
watch(() => props.question.id, () => { answer.value = ''; multi.value = []; });

const options = computed(() => (Array.isArray(props.question.options) ? props.question.options : []));
const stars = computed(() => Number(props.question.max) || 5);

const HTML_TYPE = { date: 'date', email: 'email', url: 'url', tel: 'tel', number: 'number' };
const htmlType = computed(() => HTML_TYPE[props.type.widget] || 'text');

const PLACEHOLDER = { email: 'form_enter_email', url: 'form_enter_url', tel: 'form_enter_phone' };
const placeholder = computed(() => t(`Projects.${PLACEHOLDER[props.type.widget] || 'form_enter_text'}`));
</script>

<style scoped>
.ff { min-width: 0; }
.ff__label { display: block; font-size: 13px; font-weight: 600; color: #3b4252; margin: 0 0 5px; }
.ff__req { color: #c0392b; margin-left: 2px; }
.ff__help { display: block; font-weight: 400; color: #9aa0b4; font-size: 12px; margin-top: 2px; }
.ff__input { width: 100%; border: 1px solid #d7d9e6; border-radius: 7px; padding: 9px 11px;
    font-size: 14px; font-family: inherit; color: #222; background: #fff; }
.ff__input:disabled { background: #fff; color: #7c8195; }
.ff__area { min-height: 92px; resize: vertical; }
.ff__choices { display: flex; flex-wrap: wrap; gap: 8px 18px; }
.ff__choice { display: flex; align-items: center; gap: 7px; font-size: 14px; color: #3b4252; }
.ff__choice input { margin: 0; }
.ff__stars { display: flex; gap: 6px; }
.ff__star { font-size: 22px; line-height: 1; color: #c9ccdb; cursor: pointer; }
.ff__star.is-on { color: #f5a623; }
.ff__range { width: 100%; }
.ff__drop { border: 1px dashed #d7d9e6; border-radius: 9px; padding: 16px; text-align: center;
    font-size: 13px; color: #9aa0b4; background: #fff; }
.ff__money { display: flex; }
.ff__sym { border: 1px solid #d7d9e6; border-right: 0; border-radius: 7px 0 0 7px; padding: 9px 11px; font-size: 14px; }
.ff__money .ff__input { border-radius: 0 7px 7px 0; }
.ff__info { border-left: 3px solid #c9d0f5; padding: 2px 0 2px 12px; font-size: 14px;
    line-height: 1.6; color: #4b5163; white-space: pre-wrap; }
</style>
