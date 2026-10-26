# OpenAI Sans

Original WOFF2 assets from the locally installed Codex desktop app, version
26.1021.3705.0, under `app.asar/webview/assets/`:

| File | Weight | Original asset |
| --- | --- | --- |
| OpenAISans-Regular.woff2 | 400 | OpenAISans-Regular-c56711d328c4.woff2 |
| OpenAISans-Medium.woff2 | 500 | OpenAISans-Medium-7b9c963f9063.woff2 |
| OpenAISans-Semibold.woff2 | 600 | OpenAISans-Semibold-e259229c5327.woff2 |

The bytes are unchanged and were verified against the archive's SHA256 metadata.
`src/styles/fonts.css` loads these assets for chat content. The interface and
code use system font stacks defined in `src/styles/tokens.css`; Segoe UI and
Consolas are referenced by name, with platform fallbacks.
