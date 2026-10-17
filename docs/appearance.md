# Wallpapers and appearance

Open the palette button in the workspace header, or **Settings → 壁纸与外观** (Wallpapers and appearance).

1. Upload a JPG, PNG or WebP image, up to 20 MB. The browser scales it proportionally and strips source metadata. The canonical PNG travels over binary WebSocket, with a 6 MB / 4 megapixel / 2560 px limit.
2. Optionally describe a style, then select **让 Codex 智能适配**. Your Codex account and selected model analyze the image and suggest colors, light/dark mode, and composition. This uses model quota and requires image input support. You may close settings and return for the result.
3. Adjust the name, cover/contain fit, focal position and reading overlay. Wallpaper proportions remain intact as the viewport changes.
4. Use **全页预览** (full-page preview), then **保存并应用** (save and apply). Exiting a preview does not persist it. Saving retains the image, palette and composition together.

Each account can save 12 desktop and 12 mobile presets. Switching presets makes no model call. Desktop browsers can only modify desktop appearance; mobile browsers can only modify mobile appearance. The other device's presets are visible but cannot be changed, activated, deleted or reset. Classification uses the browser's mobile user-agent identity, rather than viewport width; user-agent overrides such as “desktop site” affect this classification.

**初始外观** restores the original light blue/white interface for the current device and keeps saved presets. Deleting the active preset removes that device's skin. The other device remains unchanged. A failed model task preserves the active appearance and allows retrying or discarding the draft. Background skin tasks stay separate from chat history.

## Implementation and storage

- Models return validated declarative colors and composition, never executable CSS, HTML, scripts or external image URLs. Shared color functions derive semantic tokens and correct text/accent/button contrast.
- Page chrome, controls, dialogs, scrollbars, Monaco and the terminal consume shared colors. Compatibility variables cover legacy CSS literals; new styles should use semantic tokens such as `--bg`, `--panel`, `--text`, `--muted` and `--accent`.
- Wallpapers live under `DATA_DIR/users/<username>/wallpapers/` and count toward storage usage. SQLite stores presets and device-specific selections. Image routes require authentication and ownership. Uploading another image replaces the previous unsaved draft for that device.
- Presets and selections survive restarts. Background job results expire after 30 minutes in memory; after restarting, regenerate from the retained draft.
- This is an independent implementation of wallpaper-driven skinning and does not require a desktop Dream Skin skill installation.

Local validation uses simulated model results for success/failure, real HTTP/WebSocket uploads, account/device isolation and persistent preset restoration. Actual model quality depends on the connected model and account.
