# Repository Guidelines

## Project Structure

This repository contains the repair-request system (報修登記系統): its requirement notes, documents, database scripts, and the static web front end published with GitHub Pages.

- `報修需求筆記.txt` at the root is the working requirements document. Record decisions and open questions there.
- `文件/` holds supporting documents: the field sheet `報修欄位表.xlsx` and setup guides such as `LINE通知設定步驟.md`.
- The web front end lives at the root: `index.html`/`app.js` (repair requests), `delivery.html`/`delivery.js` (delivery-date inquiries), `help.html` (user guide), `common.js` (shared Supabase client, login, helpers), `config.js` (Supabase URL and publishable key), `style.css`, `favicon.svg`.
- `supabase/` holds SQL scripts (`schema.sql`, `delivery_inquiries.sql`, `update_v1.1.sql`, …) and Edge Functions under `supabase/functions/`.
- `README.md` describes the system and deployment steps; `CHANGELOG.md` records each version. Keep `AGENTS.md` at the root.

## Editing the Requirements and Documents

- Keep the existing filenames so reviewers can locate the current version.
- Follow the existing language (Traditional Chinese) and terminology. Reuse the notes' `■` section headings and `-` list style.
- Record open questions explicitly when a requirement needs confirmation; move them to a decided section once answered.
- Keep temporary exports and review copies outside this repository unless they are part of the requested deliverable.

## Editing the Web Front End and Database

- Plain HTML/CSS/JavaScript with no build step. Load third-party scripts only from a CDN with an exact version and an SRI hash, and keep each page's Content-Security-Policy in sync with what it loads and connects to.
- Never put secret keys in `config.js` or any committed file; only the Supabase publishable key belongs in the front end.
- Render user-entered text with `textContent`, never as HTML.
- Database changes go in a new, re-runnable SQL file under `supabase/` (for example `update_v1.2.sql`). Keep the three layers — GRANT, RLS, CHECK — and comment each section in Traditional Chinese. Do not edit SQL files that have already been run in production; add an update file instead.
- When releasing a version, update `VERSION` in `common.js`, the `?v=` query on CSS/JS links in every page, and `CHANGELOG.md`.

## Validation

There is no build or lint step. After changing the web pages, open them in a browser at phone and desktop widths and check: the form submits, the list loads and filters, admin actions work after login, and there is no horizontal scrolling. Test SQL on a scratch PostgreSQL database (anonymous, authenticated, and admin roles) before asking for it to be run in Supabase. After editing documents, reopen them and verify headings, lists, and tables display correctly.

## Sharing Changes

Commit on a feature branch and open a pull request into `main`; GitHub Pages publishes from `main`. In the pull request, name the files and sections changed, list any SQL that must be run in Supabase, and summarize decisions and open questions.
