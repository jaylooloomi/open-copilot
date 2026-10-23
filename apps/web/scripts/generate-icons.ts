// npm run icons -w @oc/web: render apps/web/icons/*.svg into apps/web/public/icons/*.png.
// Run it after editing an SVG and commit the PNGs (the build does not render them).
import { relative } from 'node:path';
import { WEB_DIR, writeIcons } from './icons';

for (const path of await writeIcons()) console.log(`[icons] ${relative(WEB_DIR, path)}`);
