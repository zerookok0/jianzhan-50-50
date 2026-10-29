# Subdirectory deployment (WordPress)

This site is built to be uploaded into a folder inside a WordPress install,
for example `https://example.com/site/`.

## Build the package

```bash
npm run build:subdir
```

This runs three steps:

1. `vite build` → `dist/`
2. `scripts/verify-dist.mjs` → asserts no root-absolute asset paths remain
3. `scripts/zip-dist.mjs` → `site.zip` (dist contents at the archive root)

Result: **`site.zip`** in the project root, containing `index.html`,
`assets/`, and `favicon.svg`.

## Upload

Unzip so the files sit directly inside the target folder:

```
public_html/
└── site/
    ├── index.html
    ├── favicon.svg
    └── assets/
        ├── index-*.js
        └── index-*.css
```

Then open `https://example.com/site/`.

## How routing behaves

`base: './'` emits relative asset URLs, so the bundle works at any depth.
The app's router defaults to **hash mode**, so real URLs look like:

```
https://example.com/site/#/collection
https://example.com/site/#/collection/hares-fur-bowl
```

Hash URLs need no server rewrite and cannot 404 when a visitor refreshes.

### Optional: clean URLs

```bash
VITE_BASE=/site/ VITE_ROUTER=history npm run build
```

This needs a rewrite of `/site/*` to `/site/index.html` (Apache `.htaccess`
or the nginx equivalent). Without that rewrite, refreshing a subpage returns
404 — which is why hash mode is the default.

## Notes

- Photos are hot-linked from the Pexels CDN, not bundled, so `site.zip`
  stays under 100 kB. Fonts load from Google Fonts.
- `canonical`, `og:image` and contact details are placeholders — set them in
  `index.html` and `src/data/site.ts` before going live.
- WordPress and this bundle are independent. Uploading new files replaces the
  app; it does not touch your theme or database.
