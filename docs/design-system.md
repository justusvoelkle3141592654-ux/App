# Design system

The values below are the ones used in `src/desktop_organizer/core/theme.py`. Change them there, not in individual widgets.

## Principles

- Calm, precise and dense where it helps. Lists, tables and forms, not cards or hero sections.
- One typeface family, one accent color, neutral grays for everything else.
- Labels carry the meaning. Icons are not used in this version.
- Sentence case. Verb-first buttons ("Create preview", "Move files"). No exclamation marks, no emojis.
- Every destructive action shows a preview or a confirmation. The default button in a confirmation is "No".

## Color

| Token | Light | Dark | Use |
|---|---|---|---|
| window | `#F3F3F3` | `#202020` | Window background |
| surface | `#FFFFFF` | `#2B2B2B` | Inputs, lists, tables, buttons |
| text | `#1B1B1B` | `#F2F2F2` | Body text |
| text_muted | `#5C5C5C` | `#A8A8A8` | Captions, hints, status text |
| border | `#D6D6D6` | `#3F3F3F` | 1 px borders |
| accent | `#2E5C8A` | `#7EA6D1` | Primary buttons, focus ring, progress |
| accent_text | `#FFFFFF` | `#101010` | Text on accent |
| hover | `#EAEAEA` | `#333333` | Hover background |
| selected | `#DCE6F1` | `#2F3D4F` | Selected rows |
| success | `#1E7A3C` | `#6CC68A` | Status only |
| warning | `#8A5A00` | `#E0B45C` | Status only |
| error | `#B42318` | `#F08B82` | Status only |

Dark mode follows Windows unless the user picks light or dark in Settings. Semantic colors appear only in status text, never as decoration.

## Typography

- Family: Segoe UI Variable, falls back to Segoe UI.
- Scale in px: 12 (caption), 14 (body, default), 16 (subtitle), 20 (title), 28 (headline).
- Weights: regular for body; the bold weight is used only for headings.

## Spacing

8 px grid, with a 4 px half step for tight rows:

| Token | Value | Use |
|---|---|---|
| space-1 | 4 px | Padding inside buttons and inputs, tight rows |
| space-2 | 8 px | Gaps between controls |
| space-3 | 16 px | Window margins, gaps between sections |
| space-4 | 24 px | Between groups |
| space-5 | 32 px | Reserved |

## Components

- **Button.** Border 1 px, radius 4 px, minimum height 24 px. Primary buttons use the accent fill. One primary button per toolbar.
- **Text field, combo box, spin box.** Surface background, 1 px border, radius 4 px.
- **List, table, tree.** Surface background, alternating rows in window color, selection in `selected`. Headers are muted text on the window color.
- **Progress bar.** 16 px high, accent fill, radius 3 px. Each tool shows its progress in the same row layout: bar, cancel button, one status line.
- **Message dialogs.** Standard Qt dialogs. Confirmations use "Yes" and "No", and "No" is the default.
- **Status text.** Muted by default. `status-ok`, `status-warn`, `status-error` only for results.

## States

- **Focus.** A 2 px accent border on the focused control. Tab order follows the layout.
- **Hover.** Buttons change to `hover`.
- **Disabled.** Muted text. Buttons that cannot run yet are disabled rather than hidden, so the next step is visible.
- **Empty.** A short sentence explains what to do next, for example "No notes yet. Press Ctrl+N to start."
- **Error.** A message box with the exact problem in plain words, and the log file keeps the details.
- **Busy.** The progress row appears with a cancel button. The window stays responsive.

## Motion

Motion is limited to standard widget behavior. The "Reduce animations" setting is stored and applied as a Qt application property; the app adds no animations of its own in this version.

## Layout rules

- Overview: search field, then a single list. Status line at the bottom.
- Tool windows: opened in their own window. A toolbar row sits at the top, then the content, then the progress row and the status line.
- Minimum window size is 560 by 420 px for tools, 480 by 420 px for the overview.
