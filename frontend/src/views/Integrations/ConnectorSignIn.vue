<template>
    <Teleport to="body">
        <div class="cx-signin-backdrop" @click.self="close">
            <div
                ref="box"
                class="ah-card aw cx-signin"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="titleId"
                tabindex="-1"
                data-test="cx-signin"
                @keydown.esc.stop.prevent="close"
            >
                <div class="aw__head">
                    <ConnectorTile :provider="row.provider" :name="name" />
                    <span :id="titleId" class="ah-h3 cx-signin__title">{{ $t('Connectors.signin.title', { provider: name }) }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Connectors.signin.close')" data-test="cx-signin-close" @click="close">
                        <ShellIcon name="x" :size="15" />
                    </button>
                </div>

                <div class="aw__body">
                    <fieldset v-if="choosesProducts" class="cx-signin__products">
                        <legend class="ah-field__label">{{ $t('Connectors.conn.products_label') }}</legend>
                        <label v-for="product in row.products" :key="product" class="cx-signin__product">
                            <input
                                type="checkbox"
                                class="ah-check"
                                :checked="picked.includes(product)"
                                :disabled="Boolean(busy)"
                                :data-test="`cx-signin-product-${product}`"
                                @change="toggle(product)"
                            />
                            <span>{{ productName(product) }}</span>
                        </label>
                        <p v-if="!picked.length" class="ah-field__hint">{{ $t('Connectors.signin.pick_one') }}</p>
                    </fieldset>

                    <section v-if="oauth" class="cx-signin__way">
                        <p class="ah-small cx-signin__text">{{ $t('Connectors.signin.oauth_lead', { provider: name }) }}</p>
                        <button
                            type="button"
                            class="ah-btn ah-btn--primary ah-btn--sm cx-signin__go"
                            :disabled="Boolean(busy) || (choosesProducts && !picked.length)"
                            data-test="cx-signin-oauth"
                            @click="startOauth"
                        >{{ busy === 'oauth' ? $t('Connectors.conn.connecting') : $t('Connectors.signin.continue', { provider: name }) }}</button>
                    </section>

                    <p v-if="oauth && token" class="cx-signin__or" role="separator">{{ $t('Connectors.signin.or') }}</p>

                    <form v-if="token" class="cx-signin__way" novalidate data-test="cx-signin-token-form" @submit.prevent="saveToken">
                        <label class="ah-field__label" :for="tokenId">{{ $t('Connectors.signin.token_label') }}</label>
                        <input
                            :id="tokenId"
                            v-model="tokenText"
                            class="ah-input"
                            type="password"
                            autocomplete="off"
                            spellcheck="false"
                            :aria-describedby="helpId"
                            :disabled="Boolean(busy)"
                            data-test="cx-signin-token"
                        />
                        <p :id="helpId" class="ah-field__hint">{{ tokenHelp }} {{ $t('Connectors.signin.token_kept') }}</p>
                        <button
                            type="submit"
                            class="ah-btn ah-btn--sm cx-signin__go"
                            :class="oauth ? 'ah-btn--secondary' : 'ah-btn--primary'"
                            :disabled="Boolean(busy) || !tokenText.trim()"
                            data-test="cx-signin-token-save"
                        >{{ busy === 'token' ? $t('Connectors.signin.checking') : $t('Connectors.signin.token_save') }}</button>
                    </form>

                    <p v-if="error" class="ah-field__error" role="alert" data-test="cx-signin-error">{{ error }}</p>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, onMounted, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useFocusTrap } from "@/composable/useFocusTrap";
import ConnectorTile from "./ConnectorTile.vue";
import { connectorApi, goToConsent } from "./connectorApi";
import { productLabel } from "./connectorLabels";
import { takesOauth, takesToken } from "./connectorCatalog";

defineOptions({ name: "ConnectorSignIn" });

const props = defineProps({
    row: { type: Object, required: true },
    name: { type: String, required: true }
});
const emit = defineEmits(["close", "connected"]);

const { t, te } = useI18n();
const uid = `cx-signin-${useId()}`;
const titleId = `${uid}-title`;
const tokenId = `${uid}-token`;
const helpId = `${uid}-help`;

const box = ref(null);
const busy = ref("");
const error = ref("");
const tokenText = ref("");

const oauth = computed(() => takesOauth(props.row));
const token = computed(() => takesToken(props.row));
const choosesProducts = computed(() => oauth.value && props.row.products.length > 1);
const held = props.row.connection && props.row.connection.products && props.row.connection.products.length ? props.row.connection.products : props.row.products;
const picked = ref([...held]);

const tokenHelp = computed(() => {
    const own = `Connectors.catalog.${props.row.provider}_token_help`;
    return te(own) ? t(own) : t("Connectors.signin.token_help", { provider: props.name });
});

useFocusTrap(box, ref(true));

const productName = (product) => productLabel(t, te, product);
const toggle = (product) => {
    picked.value = picked.value.includes(product) ? picked.value.filter((value) => value !== product) : [...picked.value, product];
};
const close = () => { if (busy.value !== "oauth") emit("close"); };

const startOauth = async () => {
    busy.value = "oauth";
    error.value = "";
    try {
        const out = await connectorApi.connect(props.row.provider, choosesProducts.value ? picked.value : props.row.products);
        if (!out?.url) throw new Error("");
        goToConsent(out.url);
    } catch (e) {
        error.value = e.message || t("Connectors.conn.connect_failed");
        busy.value = "";
    }
};

/* The field is emptied whatever the answer: a token the app refused is no use, and one it took is never shown again. */
const saveToken = async () => {
    const given = tokenText.value.trim();
    if (!given) return;
    busy.value = "token";
    error.value = "";
    tokenText.value = "";
    try {
        const view = await connectorApi.saveToken(props.row.provider, given);
        emit("connected", view);
    } catch (e) {
        error.value = e.message || t("Connectors.signin.token_failed");
    } finally {
        busy.value = "";
    }
};

onMounted(() => {
    const first = box.value?.querySelector(token.value && !oauth.value ? "input[type=password]" : "button.cx-signin__go, input[type=checkbox]");
    first?.focus();
});
</script>

<style scoped>
.cx-signin-backdrop { position: fixed; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--scrim); }
.cx-signin { width: 480px; }
.cx-signin__title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.cx-signin__products { border: 0; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; min-width: 0; }
.cx-signin__products legend { width: 100%; margin-bottom: 6px; }
.cx-signin__products .ah-field__hint { width: 100%; margin: 0; }
.cx-signin__product { display: inline-flex; align-items: center; gap: 8px; font: var(--text-body); color: var(--ink); cursor: pointer; min-height: var(--hit-min); }
.cx-signin__way { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-width: 0; }
.cx-signin__way .ah-input { width: 100%; }
.cx-signin__text { margin: 0; }
.cx-signin__way .ah-field__hint { margin: 0; }
.cx-signin__or { display: flex; align-items: center; gap: 10px; margin: 0; font: var(--text-label); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-label); }
.cx-signin__or::before, .cx-signin__or::after { content: ""; flex: 1; height: 1px; background: var(--hairline); }
@media (max-width: 480px) {
    .cx-signin-backdrop { padding: 12px; }
    .cx-signin__go { width: 100%; min-height: 40px; }
}
</style>
