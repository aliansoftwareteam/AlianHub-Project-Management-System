const humanize = (value) => String(value || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

/* Provider and product ids come from the server's registry, which can grow new ones; a translated label is used
 * when the locale has one and the id is humanised otherwise, so a connector added later still reads as words. */
export const providerLabel = (t, te, id) => {
    const key = `Connectors.conn.provider_${id}`;
    return te(key) ? t(key) : humanize(id);
};

export const productLabel = (t, te, product) => {
    const key = `Connectors.conn.product_${product}`;
    return te(key) ? t(key) : humanize(product);
};

export const statusLabel = (t, te, status) => {
    const key = `Connectors.conn.status_${status}`;
    return te(key) ? t(key) : humanize(status);
};

export const formatDate = (value) => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
};
