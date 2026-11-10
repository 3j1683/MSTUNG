# Repository Guidelines

## Project Structure

This workspace contains the repair request notes in `報修需求筆記.docx` at the root. Use that file as the working document for changes to the notes. Keep `AGENTS.md` at the root so contributors can find these instructions. The current workspace has no source code, test directory, or separate asset directory.

## Editing the Document

- Use a Word-compatible editor to update `報修需求筆記.docx`. Keep the existing filename so reviewers can locate the current version.
- Follow the document's existing language and terminology. Reuse its heading, list, and table styles when adding content so related entries are easy to scan.
- Record open questions explicitly when a requirement needs confirmation. Keep temporary exports and review copies outside this folder unless they are part of the requested deliverable.

## Validation

This workspace has no build, lint, or automated test commands. After editing, reopen the saved document and verify that it opens, the requested changes are present, and any affected pages display correctly. Check headings, lists, tables, and page breaks where the edit could affect layout.

## Sharing Changes

This workspace has no Git history to establish commit conventions. When sharing a revision for review, name the document, identify the sections changed, and summarize any decisions or open questions. If the document is later tracked in Git, include the same details in the pull request so reviewers know where to look.
