/* The style for an `.ah-mask-icon`: the icon file is drawn as a mask, so it takes the theme's colour instead of the one baked into the file. */
export const maskOf = (src) => ({ '--mask-icon': `url("${src}")` });
