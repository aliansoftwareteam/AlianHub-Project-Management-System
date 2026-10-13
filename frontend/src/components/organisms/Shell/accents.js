export const ACCENT_CHOICES = ["indigo", "blue", "purple", "teal", "green", "orange", "pink"];

/* The accent tokens.css puts on :root, so it needs no attribute. */
export const DEFAULT_ACCENT = "indigo";

export const accentOf = (stored) => (ACCENT_CHOICES.includes(stored) ? stored : DEFAULT_ACCENT);
