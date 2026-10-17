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

General settings display a shared optimistic draft and persist through `createSettingsQueue()` in `shared/settings-save.js`. Requests are serialized, unsent edits are merged, and rejected fields revert to confirmed values while later changes continue saving. The queue belongs to the workspace so closing/reopening settings retains pending edits; composer settings use the same queue. Preserve stable controls and the close button during saves. Settings tabs have no entrance movement, and the dialog fades without backdrop blur or a transform that would disturb fixed-position dropdowns.

Monaco and xterm cannot consume CSS expressions such as `color-mix()`. Read their palette through `appearanceColors()` in `appearance-runtime.js`, which resolves theme values to concrete hex colors. Keep the editor selection distinct from its quiet current-line highlight.

## Visual verification

Check default light and dark modes and a saved wallpaper preset. Review desktop, 390px, and 320px layouts, including long labels, dropdown edges, modal scrolling, and composer controls. Exercise hover, focus, selected, disabled, and busy states. Preserve reduced-motion and forced-colors rules; distinguish source inspection from testing those system settings in a browser. Use synthetic accounts and data for interactive checks that change settings or files.
