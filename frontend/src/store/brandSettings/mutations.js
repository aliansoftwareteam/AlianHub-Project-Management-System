export const mutateBrandSettings = (state, payload) => {
    const {data} = payload;
    state.brandSettings = data;
}

export const mutatePublicConfig = (state, data) => {
    state.publicConfig = data || {};
}