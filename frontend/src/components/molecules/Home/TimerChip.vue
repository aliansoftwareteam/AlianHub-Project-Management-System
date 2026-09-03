<template>
    <div v-if="timer.active" class="hc-timer" role="status">
        <div class="hc-timer__label" :title="timer.active.taskName">{{ $t('HomeV2.tracking', { task: timer.active.taskName }) }}</div>
        <div class="hc-timer__row">
            <span class="hc-timer__clock">{{ clock }}</span>
            <button type="button" class="hc-timer__btn" @click="timer.active.running ? pause() : resume()">
                <ShellIcon :name="timer.active.running ? 'pause' : 'play'" :size="12" />
                {{ timer.active.running ? $t('HomeV2.pause') : $t('HomeV2.resume') }}
            </button>
            <button type="button" class="hc-timer__btn hc-timer__btn--icon" :title="$t('HomeV2.stop_log')" :disabled="stopping" @click="finish">
                <ShellIcon name="stop" :size="12" />
            </button>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useTimer } from "./useTimer";
import { fmtClock, fmtEstimate } from "./homeFormat";

defineOptions({ name: "TimerChip" });

const { t } = useI18n();
const $toast = useToast();
const companyId = inject("$companyId");
const userId = inject("$userId");
const { timer, elapsedMs, pause, resume, stop } = useTimer();
const stopping = ref(false);

const clock = computed(() => fmtClock(elapsedMs.value));

async function finish() {
    stopping.value = true;
    try {
        const result = await stop({ companyId: companyId.value, userId: userId.value });
        if (result) {
            $toast.success(t("HomeV2.timer_logged", { duration: fmtEstimate(Math.max(1, Math.round(result.elapsedMs / 60000))), task: result.taskName }), { position: "top-right" });
        }
    } catch (error) {
        console.error("timer log failed", error);
        $toast.error(t("HomeV2.timer_log_failed"), { position: "top-right" });
    } finally {
        stopping.value = false;
    }
}
</script>
