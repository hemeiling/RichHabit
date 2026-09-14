# AI Workspace V1 — Image Understanding: VERIFIED

An existing capability of the released AI Workspace (`f7499fc`). An admin can
attach an image to a message and Claude sees it: it describes what is in it and
reads text from it. **Do not rebuild this.** Extend it only for the limitations
listed below.

Verified 2026-09-13 against the released code, with real Claude, on a local
throwaway database. No application code, schema, migration, configuration or
production system was changed for the verification.

## What V1 supports

| Capability | How it works | Where |
| --- | --- | --- |
| Formats | PNG, JPEG, GIF, WebP | `MIME_TYPES_BY_KIND` in `src/lib/aiWorkspace/types.ts`; `ai_files.mime_type` check |
| Image size limit | 5 MB per image (application limit, configurable with `AI_WORKSPACE_MAX_IMAGE_MB`) | `src/lib/env.ts`; enforced in `src/app/api/admin/ai/workspace/files/route.ts` and `recordUpload` |
| Type detection | server-side, from the file's leading bytes (magic bytes); the browser's declared type and the filename are ignored | `src/lib/aiWorkspaceRuntime/fileType.ts` |
| Storage | bytes in Postgres (`ai_files.content`), with size, SHA-256 and owner | `recordUpload` in `src/lib/aiWorkspace/queries.ts` |
| De-duplication | the same bytes (SHA-256) uploaded again to the same conversation or project return the existing file | `recordUpload`; `ai_files_dedupe_idx` |
| Anthropic Files API | uploaded once when first attached to a message; the `file_…` id is recorded and reused for later requests | `resolveAttachment` in `src/lib/aiWorkspaceRuntime/reply.ts`; `ai_file_provider_copies` |
| Claude vision | native `image` content blocks, `source: { type: "file", file_id }`, placed before the message text | `toAnthropicContent` in `src/lib/ai/claude.ts`; `userTurn` in `context.ts` |
| Fallback | if the Files API upload fails, the image is sent inline as a base64 `image` block for that request | `resolveAttachment` |
| Understanding | object and scene description | live checks below |
| Text in images | Claude reads text rendered in the image | live checks below |
| Upload notice | uploads are refused until the current upload disclosure is accepted | `recordUpload`; `disclosure.ts` |
| Access | admin only: every workspace route answers 404 to anyone else; files are owner-scoped | `workspaceAdmin` in `http.ts`; `queries.ts` |
| Logging | no image contents, prompts, replies or keys in application logs (codes only) | `logUnexpected` in `http.ts`; boundary tests |

Request path: browser → `POST /api/admin/ai/workspace/files` (type from bytes,
limits, quota) → Postgres `ai_files` → on first use, Anthropic Files API upload
(`ai_file_provider_copies`) → Claude Messages request with an `image` block
referencing the `file_id` → streamed reply.

## Limitations

- **BMP is not supported** (refused with 415). So are HEIC, TIFF and SVG.
- **Animated GIFs:** Claude reads the first frame only.
- **No resizing:** images are sent to Claude as uploaded. Claude downscales
  large images itself (Claude Sonnet 5 uses a 2576 px long edge).
- **5 MB limit:** RichHabit allows 5 MB per image, although the Anthropic API
  accepts up to 10 MB.
- **Token cost:** large images can use materially more input tokens (up to about
  4,800 visual tokens per image on Claude Sonnet 5).

## Evidence (2026-09-13)

| Check | Result |
| --- | --- |
| live Claude image checks against V1 (`f7499fc`) | **30 / 30 passed** |
| V1 image-path unit tests (Claude adapter, reply, routes, runtime) | **46 / 46 passed** |
| PNG vision, end to end | described 3/3 objects; read 2/2 lines of text; Files API copy made and reused |
| JPEG vision, end to end | described 3/3 objects; read 2/2 lines of text; Files API copy made and reused |
| GIF and WebP | uploaded, typed from bytes, objects described and text read |
| validation | 5.3 MB PNG refused (413); BMP refused (415); binary junk named `.jpg` refused (415); text renamed `.png` stored as text, not image; upload refused before the notice is accepted (409) |
| control | the same text question without an image did not produce the image's text |
| model | Anthropic Models API reports `claude-sonnet-5` `image_input: supported` |
| logs | no key, prompt, reply, image text or image bytes in the server log |
| production | code, schema, configuration and database unchanged; nothing deployed |
