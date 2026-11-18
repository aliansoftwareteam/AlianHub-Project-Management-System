<template>
    <a class="ah-skip-link" href="#ah-main" @click.prevent="skipToMain">{{ $t('Shell.skip_to_content') }}</a>
</template>

<script setup>
defineOptions({ name: "SkipLink" });

// The router lives in the hash, so following "#ah-main" would navigate away instead of scrolling.
function skipToMain() {
    const main = document.getElementById("ah-main") || document.querySelector("main");
    if (!main) return;
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    main.focus();
}
</script>

<style>
.ah-skip-link {
    position: fixed;
    top: 8px;
    left: 8px;
    z-index: 10000;
    padding: 10px 14px;
    border-radius: var(--r-input, 8px);
    background: var(--brand);
    color: var(--on-brand);
    font: 600 13px/1.2 var(--font-ui);
    text-decoration: underline;
    transform: translateY(calc(-100% - 16px));
}
.ah-skip-link:focus { transform: none; outline: 3px solid var(--ink); outline-offset: 2px; }
#ah-main:focus { outline: none; }
@media (prefers-reduced-motion: no-preference) {
    .ah-skip-link { transition: transform var(--t-state, 150ms) var(--ease, ease); }
}
</style>
