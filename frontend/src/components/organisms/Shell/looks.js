export const VARIANT_CHOICES = ["a", "b", "c", "classic"];

/* The look tokens.css puts on :root, so it needs no attribute. */
export const DEFAULT_VARIANT = "b";

export const lookOf = (stored) => stored || DEFAULT_VARIANT;
