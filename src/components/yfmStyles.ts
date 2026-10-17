/**
 * YFM content styles for `@diplodoc/transform` output (NotePreview, and the release notes in
 * UpdateDialog).
 *
 * These are imported by the two LAZY consumers instead of `main.tsx`, so the ~40 kB of `.yfm`
 * typography no longer sits in the startup stylesheet: it arrives with the chunk that actually
 * renders Markdown. Everything here is `.yfm`-scoped, so loading it after `index.css` changes no
 * cascade outcome — note the import order inside this module is the one the preview needs.
 */
import '../yfm-tokens.css';
import '@diplodoc/transform/dist/css/_yfm-only.css';
import '@diplodoc/transform/dist/css/base.css';
