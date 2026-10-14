`Collapse-Bold.woff2` is the original empty-chat display font from
`@nous-research/ui@0.19.1` (`dist/fonts/Collapse-Bold.woff2`). That package
declares the MIT license. UI 1.x removed font assets from its npm package.

The Vite alias resolves the pinned renderer's font URL to this local asset so
it is included in production builds and the PWA precache.
