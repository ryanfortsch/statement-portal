# Self-hosted fonts

Fraunces (serif), Inter (sans) and JetBrains Mono (mono), served from this
folder since 2026-10-22. The build reads only the repository and never
contacts Google.

## Why

`next/font/google` downloads the CSS and font files from Google on every
build. That download flaked: Turbopack's "Can't resolve
'@vercel/turbopack-next/internal/font/google/font'" was 7 of the 8 failed
production builds between 10/15 and 10/22, and a merge that hit it did not
deploy until the next one.

## What is here

- 19 woff2 files: the exact bytes `next/font/google` served in production
  on 2026-10-22, copied from the build output of the old configuration and
  renamed by family, style and subset. Every one is a variable font on the
  weight axis (Google pinned the other axes). Versions: Fraunces 1.000
  (b76b70a41), Inter 4.001 (66647c0bb), JetBrains Mono 2.211.
- `fonts.css`: every subset except latin, the three fallback faces and the
  three variables globals.css reads.
- `OFL-*.txt`: each family's SIL Open Font License 1.1, from the google/fonts
  repository. The license requires it to travel with the files.

The latin faces are declared by the `next/font/local` calls in
`../layout.tsx`, because next/font is what preloads them, as it did before.

## Rules that keep rendering identical

The two files reproduce Google's `@font-face` rules one for one. Keep these
four properties, which `src/lib/__tests__/self-hosted-fonts.test.ts` checks:

1. **Real family names.** The faces are named `Fraunces`, `Inter` and
   `JetBrains Mono`. Pages and documents name them directly (the sign page,
   staff letters, the statement render page's chart), so a scoped name would
   drop them to the fallback.
2. **One face per weight, every subset.** Fraunces 300 to 600 normal and
   italic, Inter 400 to 700, JetBrains Mono 400 and 500, each declared per
   weight against the same variable file, exactly as Google did. Not a
   weight range: Chrome merges faces that share a family, style and exact
   weight, and the statement render page links Google's own Fraunces on top
   of these, so a range would change which file draws that page.
3. **Every subset.** Google served latin, latin-ext and vietnamese (plus
   greek and cyrillic for Inter and JetBrains Mono), each limited by
   `unicode-range`, so a guest name like "Łukasz" stays in Fraunces. Only
   latin is preloaded. Latin is declared last because where ranges overlap
   the last face wins.
4. **The fallback faces and variables are Google's.** `Fraunces Fallback`
   is Times New Roman and the other two are Arial, sized by Google's
   metrics, and each variable reads `"<Family>", "<Family> Fallback"`. The
   fallback also draws any glyph no subset carries (an arrow in Inter text),
   so its metrics show on screen. next/font/local would compute different
   metrics from the file, and its `variable` option writes the const's name
   as the first family, which is why both are off in the layout and set here.

## Changing it

To add a weight, add the face to every subset of that family: the latin
entry in `../layout.tsx` and each block in `fonts.css`. The variable files
already contain every weight on their axis (Fraunces and Inter 100 to 900,
JetBrains Mono 400 to 800).

To refresh the files from Google, build once with the old `next/font/google`
configuration (git history before 2026-10-22), copy the files from
`.next/static/media` (the generated CSS maps each one to its subset), and
diff the generated `@font-face` rules against these.
