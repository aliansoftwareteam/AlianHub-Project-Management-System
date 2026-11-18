module.exports = async () => {
    if (globalThis.__E2E_HARNESS__) await globalThis.__E2E_HARNESS__.stop();
};
