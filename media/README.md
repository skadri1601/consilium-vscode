# Extension media

- `activity-bar-icon.svg` - used in the VS Code activity bar (24×24 monochrome, uses `currentColor`).
- `consilium-icon.png` - **TODO**: 128×128 PNG for the Marketplace listing.

## Marketplace icon spec (TODO)

Required:

- 128×128 PNG, 24-bit
- Drop at `media/consilium-icon.png`
- The `package.json` already references it via `"icon": "media/consilium-icon.png"`

The brand asset at `apps/web/public/brand/consilium-icon.svg` is the
canonical mark. Export it to a 128×128 PNG before publishing:

```bash
# Using rsvg-convert (recommended)
rsvg-convert -w 128 -h 128 \
  apps/web/public/brand/consilium-icon.svg \
  -o apps/vscode-extension/media/consilium-icon.png

# Or via Inkscape
inkscape apps/web/public/brand/consilium-icon.svg \
  --export-type=png --export-width=128 --export-height=128 \
  --export-filename=apps/vscode-extension/media/consilium-icon.png
```

Once dropped, run `pnpm package` from `apps/vscode-extension/` and verify the icon shows in the resulting `.vsix`.
