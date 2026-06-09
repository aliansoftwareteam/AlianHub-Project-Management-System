Every status entry needs a `textColor` — a 6-digit hex like `#FF9600`.

Pick colors that are clearly readable on a white-ish background. Saturated
accent colors work; pastels and near-white do not. Never emit `#FFFFFF`,
`#FEFEFE`, `#F8FAFC`, or anything lighter than roughly `#CCCCCC`.

The server derives the background tint from `textColor` automatically — you
do not need to emit a background color.
