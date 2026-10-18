# Workspace UI styles

The workspace follows the toolbar's quiet visual language: neutral surfaces, fine borders, compact rounded controls, and restrained hover and selection feedback. Existing keyboard behavior, accessible names, and loading states belong to the controls and must survive visual changes.

## Shared foundation

`src/style.css` is the entry point. It imports the foundation and feature styles from `src/styles/` in dependency order. Keep feature layout rules in the corresponding module rather than appending overrides to the entry point. Responsive rules follow each module's base styles, from wider to narrower breakpoints.

`tokens.css` defines light and dark semantic colors and derived UI tokens. Use `--bg`, `--side`, `--panel`, `--text`, `--muted`, `--line`, and `--accent` for surfaces and text. Use `--success`, `--warning`, and `--danger` for meaning. Wallpaper presets override the semantic palette, so controls should use these variables instead of literal colors or the removed legacy color aliases.

Shared geometry and feedback use `--ui-radius-*`, `--ui-control`, `--ui-field-height`, `--ui-hover`, `--ui-press`, `--ui-selected`, `--ui-focus`, and `--ui-shadow-*`. Standard icon controls are 36px, fields are 40px, and their usual corner radius is 10px. Keep existing compact variants where the layout needs them. Avoid adding decorative shadows or movement to ordinary rows and buttons.

The composer intentionally retains its original compact bordered controls, resource/usage cards, native icon hints, and animated reasoning accents. Its `--composer-*` palette is centralized in `tokens.css` and scoped to the composer and model popover, so it can keep the original blue light/dark appearance while other surfaces follow the newer toolbar design. Custom wallpaper themes replace this palette with semantic theme colors. Keep the composer rules together in `composer.css`.

## Controls and surfaces

- Use `IconButton` for shared icon actions. Supply a meaningful `title`; it provides the accessible name and compact tooltip. Add `description` when an action needs explanation.
- `Tooltip` coordinates pending and visible tips across the app. Preserve pointer delay, immediate keyboard display, Escape dismissal, and viewport clamping. Connection details retain their richer status card.
- Use `Select` for custom dropdowns, and preserve its keyboard navigation and disabled state.
- Use `Modal` and `ActionDialog` for dialogs and confirmations. Preserve their focus management, inert background, busy state, and cancellation behavior.
- `SettingsPanel` owns the settings navigation and consistent section headings; appearance editing remains in `Appearance` with its current-device restriction.
- Conversation mode (execute/plan) is configured in general settings. The composer retains attachment, permission, and model controls.
- New-conversation suggestions use a compact icon/text/arrow grid. Keep titles and descriptions together with the existing 13px/11px desktop typography (12px mobile titles); retain descriptions when the editor is open and switch to one column when the chat container is narrow.
- `Logo` renders a solid rounded tile with large/small four-point sparks; `assets/logo.svg` keeps the same silhouette for the static favicon, including at 16px. Only the home hero opts into animation: a 90-degree hover turn with a gentle overshoot, a slow small-star twinkle, and a halo every 3 seconds. Use theme colors, pause idle animation behind modals, and show a static mark with reduced motion. Keep sidebar and other compact branding static.
- The sidebar user row has two sibling buttons: the avatar/name area opens personal account settings, and the outlined gear opens general settings. Retain the original sidebar typography: 12px/500 for the username, 9px for the role, and 12px for avatar initials. Keep the circular avatar, truncated username, and role badge together; superadmins use the accent, admins use success, and members use muted tones. The avatar dot shares the toolbar's socket status (green when connected, yellow while connecting/reconnecting, red when disconnected/expired); include the status in the profile button's accessible name.

General settings display a shared optimistic draft and persist through `createSettingsQueue()` in `shared/settings-save.js`. Requests are serialized, unsent edits are merged, and rejected fields revert to confirmed values while later changes continue saving. The queue belongs to the workspace so closing/reopening settings retains pending edits; composer settings use the same queue. Preserve stable controls and the close button during saves. Settings tabs have no entrance movement.

All shared dialogs use a single 140ms opacity fade without backdrop blur, scaling, or a second panel animation. Keep shadows bounded and pause the composer's animated background while its workspace is inert. `Modal` owns initial focus before the first paint and uses `preventScroll`; action dialogs provide their intended input/cancel ref instead of focusing twice. Capture menu triggers before they close and restore focus after the portal leaves the DOM, unless a new dialog has taken over. Keep the close control in place, disabled during saves, so the heading does not reflow. Exit callbacks share `DIALOG_CLOSE_MS` with the CSS duration, including reduced-motion handling. Unchanged conversation turns are memoized so opening a dialog does not rebuild their contents.

Monaco and xterm cannot consume CSS expressions such as `color-mix()`. Read their palette through `appearanceColors()` in `appearance-runtime.js`, which resolves theme values to concrete hex colors. Keep the editor selection distinct from its quiet current-line highlight.

## Visual verification

Project code keeps file IO, uploads, save/conflict checks, and selection actions in the existing workspace callbacks. `ProjectFiles` owns the presentation and the local `.meta` visibility preference; `CodeEditor` owns cursor/indent/language display so cursor movement does not rerender the workspace. The status, save button, and dirty tab all derive from the same content/original comparison. Show actual model indentation rather than forcing a different editing behavior.

The reference class mapping is `.cp-header` → `.editor-title`, `.cp-explorer` → `.file-explorer`, `.cp-ex-head` → `.explorer-heading`, `.cp-row` → `.file-row`, `.cp-tabs` → `.editor-tabbar`/`.editor-tabs`, `.cp-crumbs` → `.file-toolbar`, `.cp-save` → `.save-file`, and `.cp-status` → `.editor-status`. Use 46/38/30/26px bars, 30px tree rows, 16px depth steps, and theme-derived editor syntax variables. Monaco gets resolved hex colors through `appearanceColors`; do not add CodeMirror or fixed light-only palettes.

Desktop explorer width defaults to 268px and uses the existing persisted drag/keyboard separator with 200–480px bounds, limited by available editor space. Phones retain the narrower responsive bounds. Header menus must stay above the editor and within the panel. Keep new-file creation in More, all three upload routes in Upload, and the complete existing file row actions and multiselect controls. The empty state advertises Ctrl+S only; there is no project-wide Ctrl+P file picker.

Check default light and dark modes and a saved wallpaper preset. Review desktop, 390px, and 320px layouts, including long labels, dropdown edges, modal scrolling, and composer controls. Exercise hover, focus, selected, disabled, and busy states. Preserve reduced-motion and forced-colors rules; distinguish source inspection from testing those system settings in a browser. Use synthetic accounts and data for interactive checks that change settings or files.
