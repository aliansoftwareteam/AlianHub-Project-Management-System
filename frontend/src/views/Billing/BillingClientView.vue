<template>
    <div class="billing__client-wrap ah-scroll">
        <p class="billing__client-note">
            <ShellIcon name="lock" :size="13" />
            {{ $t('BillingV2.client_view_note') }}
            <span class="ah-toolbar__spacer"></span>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="copyLink">
                <ShellIcon name="share" :size="13" />
                {{ linkCopied ? $t('BillingV2.link_copied') : $t('BillingV2.copy_link') }}
            </button>
        </p>

        <p v-if="clientView.loading && !view" class="billing__state">{{ $t('BillingV2.loading') }}</p>
        <div v-else-if="clientView.error" class="ah-empty">{{ $t('BillingV2.load_failed') }}</div>

        <div v-else-if="view" class="billing__client-frame">
            <header class="billing__client-head">
                <span class="billing__client-mark"></span>
                <span class="billing__client-title">{{ view.project.name }}</span>
                <span class="ah-mono billing__client-shared">{{ $t('BillingV2.shared_by', { name: (view.project.sharedBy || '').toUpperCase() }) }}</span>
                <span class="ah-toolbar__spacer"></span>
                <span class="ah-chip ah-chip--mono">{{ $t('BillingV2.client_badge') }}</span>
            </header>

            <div class="billing__client-grid">
                <div class="billing__client-col">
                    <section class="ah-card billing__client-card">
                        <div class="billing__client-card-head">
                            <span class="ah-h3">{{ $t('BillingV2.progress') }}</span>
                            <span class="ah-mono billing__client-count">
                                {{ $t('BillingV2.milestones_complete', { done: view.progress.complete, total: view.progress.total }) }}
                            </span>
                        </div>
                        <div v-if="!view.progress.milestones.length" class="ah-empty">{{ $t('BillingV2.no_milestones') }}</div>
                        <div v-else class="billing__track">
                            <div v-for="m in view.progress.milestones" :key="m.id" class="billing__track-step">
                                <div class="billing__track-bar" :class="`is-${m.state}`">
                                    <span v-if="m.state === 'in_progress'" :style="{ width: `${m.percent}%` }"></span>
                                </div>
                                <div class="billing__track-name" :class="{ 'is-muted': m.state === 'upcoming' }">{{ m.name }}</div>
                                <div class="ah-mono billing__track-meta" :class="`is-${m.state}`">{{ stepMeta(m) }}</div>
                            </div>
                        </div>
                    </section>

                    <section class="ah-card billing__client-card billing__waiting">
                        <div class="billing__client-card-head">
                            <span class="ah-h3">{{ $t('BillingV2.waiting_on_you') }}</span>
                            <span v-if="view.waitingOnYou.length" class="billing__badge">{{ view.waitingOnYou.length }}</span>
                        </div>
                        <div v-if="!view.waitingOnYou.length" class="ah-empty">{{ $t('BillingV2.nothing_waiting') }}</div>
                        <div v-for="item in view.waitingOnYou" :key="item.id" class="billing__waiting-row">
                            <span class="billing__waiting-box"></span>
                            <div class="billing__waiting-body">
                                <div class="billing__waiting-title">{{ item.title }}</div>
                                <div class="ah-small">{{ waitingMeta(item) }}</div>
                            </div>
                            <span class="ah-btn ah-btn--sm" :class="item.action === 'review' ? 'ah-btn--primary' : 'ah-btn--secondary'">
                                {{ item.action === 'review' ? $t('BillingV2.review') : $t('BillingV2.open_item') }}
                            </span>
                        </div>
                    </section>

                    <section class="ah-card billing__client-card">
                        <span class="ah-h3">{{ $t('BillingV2.recent_updates') }}</span>
                        <div v-if="!view.updates.length" class="ah-empty">{{ $t('BillingV2.no_updates') }}</div>
                        <div v-for="(update, index) in view.updates" :key="index" class="billing__update">
                            <span class="ah-mono billing__update-date">{{ (dayLabel(update.date) || '').toUpperCase() }}</span>
                            <span class="billing__update-text">{{ update.text }}</span>
                        </div>
                    </section>
                </div>

                <div class="billing__client-col">
                    <section class="ah-card billing__client-card">
                        <span class="ah-h3">{{ $t('BillingV2.client_invoices') }}</span>
                        <div v-if="!view.invoices.length" class="ah-empty">{{ $t('BillingV2.no_invoices') }}</div>
                        <div v-for="inv in view.invoices" :key="inv.number" class="billing__client-invoice">
                            <span class="ah-dot" :class="inv.status === 'paid' ? 'ah-dot--ok' : 'ah-dot--warn'"></span>
                            <div class="billing__client-invoice-body">
                                <div class="billing__waiting-title">{{ inv.number }}</div>
                                <div class="ah-small" :class="{ 'billing__due-warn': inv.payable }">
                                    {{ inv.status === 'paid' ? $t('BillingV2.paid_on', { date: dayLabel(inv.issuedDate) }) : $t('BillingV2.due_net', { date: dayLabel(inv.dueDate) }) }}
                                </div>
                            </div>
                            <span class="billing__figure">{{ symbol }}{{ formatAmount(inv.amount) }}</span>
                        </div>
                        <span v-if="view.payNext" class="ah-btn ah-btn--primary ah-btn--block ah-btn--sm">
                            {{ $t('BillingV2.pay_invoice', { number: view.payNext }) }}
                        </span>
                    </section>

                    <section v-if="view.canMessage" class="ah-card billing__client-card">
                        <span class="ah-h3">{{ $t('BillingV2.ask_us') }}</span>
                        <form class="ah-field" @submit.prevent="send">
                            <textarea
                                v-model="message"
                                class="ah-input ah-textarea"
                                :class="{ 'ah-input--error': messageError }"
                                :placeholder="$t('BillingV2.message_placeholder')"
                                maxlength="2000"
                                rows="3"
                            ></textarea>
                            <span v-if="messageError" class="ah-field__error">{{ messageError }}</span>
                            <div class="billing__message-foot">
                                <span class="ah-small">{{ $t('BillingV2.message_hint') }}</span>
                                <span class="ah-toolbar__spacer"></span>
                                <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="sending">{{ $t('BillingV2.send') }}</button>
                            </div>
                        </form>
                    </section>

                    <p class="ah-card billing__privacy">{{ $t('BillingV2.client_privacy') }}</p>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { dayLabel } from "./useBilling";

defineOptions({ name: "BillingClientView" });

const props = defineProps({ billing: { type: Object, required: true } });

const { t } = useI18n();
const $toast = useToast();

const clientView = computed(() => props.billing.clientView);
const view = computed(() => clientView.value.data);
const symbol = computed(() => (props.billing.contract.data ? props.billing.contract.data.contract.currencySymbol : "$"));

const formatAmount = (amount) => Math.abs(Number(amount) || 0)
    .toFixed(Math.abs(Number(amount) || 0) % 1 === 0 ? 0 : 2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const stepMeta = (m) => {
    if (m.state === "done") return t("BillingV2.done_on", { date: (dayLabel(m.completedDate) || "").toUpperCase() });
    if (m.state === "in_progress") return t("BillingV2.percent_due", { percent: m.percent, date: (dayLabel(m.dueDate) || "").toUpperCase() });
    return t("BillingV2.due_on", { date: (dayLabel(m.dueDate) || "").toUpperCase() });
};

const waitingMeta = (item) => {
    const parts = [];
    if (item.milestone) parts.push(item.milestone);
    if (item.waitingSince) parts.push(t("BillingV2.waiting_since", { date: dayLabel(item.waitingSince) }));
    if (item.dueDate) parts.push(t("BillingV2.needed_by", { date: dayLabel(item.dueDate) }));
    return parts.join(" · ");
};

const message = ref("");
const messageError = ref("");
const sending = ref(false);

const send = async () => {
    if (!message.value.trim()) {
        messageError.value = t("BillingV2.message_empty");
        return;
    }
    messageError.value = "";
    sending.value = true;
    const result = await props.billing.sendClientMessage(message.value.trim());
    sending.value = false;
    if (result.ok) {
        message.value = "";
        $toast.success(t("BillingV2.message_sent"));
    } else {
        messageError.value = result.message || t("BillingV2.save_failed");
    }
};

const linkCopied = ref(false);
const copyLink = async () => {
    const url = await props.billing.shareLink();
    if (!url) {
        $toast.error(t("BillingV2.link_failed"));
        return;
    }
    try {
        await navigator.clipboard.writeText(url);
        linkCopied.value = true;
        setTimeout(() => { linkCopied.value = false; }, 2000);
    } catch (error) {
        $toast.success(url);
    }
};

onMounted(() => { if (!view.value) props.billing.loadClientView(); });
</script>
