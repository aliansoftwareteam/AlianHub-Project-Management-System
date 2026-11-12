<template>
    <section class="ah-card cx-servers" :aria-labelledby="titleId" data-test="cx-custom-servers">
        <div class="ah-card__body cx-servers__body">
            <h3 :id="titleId" class="ah-h3">{{ $t('Connectors.workspace.servers_title') }}</h3>
            <p class="ah-small cx-servers__lead">{{ $t('Connectors.workspace.servers_lead') }}</p>
            <slot>
                <p class="ah-empty cx-servers__soon" data-test="cx-custom-servers-soon">{{ $t('Connectors.workspace.servers_soon') }}</p>
            </slot>
        </div>
    </section>
</template>

<script setup>
import { useId } from "vue";

/* Task 096 fills this with the workspace's custom MCP servers; until then it only says they are coming. */
defineOptions({ name: "CustomServers" });

const titleId = `cx-servers-${useId()}`;
</script>

<style scoped>
.cx-servers { max-width: 900px; }
.cx-servers__body { display: flex; flex-direction: column; gap: 8px; }
.cx-servers__lead, .cx-servers__soon { margin: 0; }
</style>
