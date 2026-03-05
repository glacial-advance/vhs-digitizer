# VHS Digitizer — Chapter Feature Requirements

**Version:** 1.1 — Addendum to PRD v1.0  
**Date:** March 2026  
**Status:** Draft

---

## 1. Overview

This addendum specifies requirements for a Chapter Management feature that allows users to divide a completed VHS recording into labeled segments. Chapters are defined manually by the user after recording is complete, stored as timestamped metadata in the database, and optionally exported as individual split video files using FFmpeg.

---

## 2. Data Model Changes

### 2.1 New `chapters` Table

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `tape_id` | INTEGER FK | References `tapes.id` — cascade delete |
| `title` | TEXT (required) | Chapter name, e.g. "Birthday Party" |
| `start_time_ms` | INTEGER (required) | Chapter start offset in milliseconds from start of recording |
| `end_time_ms` | INTEGER | Chapter end offset in milliseconds; null if the chapter runs to the next chapter or end of file |
| `notes` | TEXT | Optional free-form description |
| `output_file` | TEXT | Absolute path to the split file, if exported |
| `exported_at` | TEXT | ISO timestamp of last successful export |
| `created_at` | TEXT | ISO timestamp, set on creation |
| `order` | INTEGER | Display/playback order; should be derived from `start_time_ms` but stored for manual overrides |

### 2.2 Changes to `tapes` Table

Add the following column:

| Column | Type | Description |
|---|---|---|
| `duration_ms` | INTEGER | Actual recorded duration in milliseconds, populated from the output file after recording stops |

This value is required to validate chapter timestamps and render the chapter editor timeline correctly.

---

## 3. Backend Requirements

### 3.1 New REST Endpoints

#### Chapters

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/tapes/{id}/chapters` | List all chapters for a tape, ordered by `start_time_ms` |
| POST | `/api/tapes/{id}/chapters` | Create a new chapter |
| PUT | `/api/chapters/{id}` | Update a chapter's title, timestamps, or notes |
| DELETE | `/api/chapters/{id}` | Delete a chapter record (does not delete the split file) |
| POST | `/api/chapters/{id}/export` | Export a single chapter as a split video file |
| POST | `/api/tapes/{id}/chapters/export-all` | Export all chapters for a tape as split video files |

#### Chapter Create/Update Payload

```json
{
  "title": "string (required on create)",
  "start_time_ms": "integer (required on create)",
  "end_time_ms": "integer (optional)",
  "notes": "string (optional)",
  "order": "integer (optional)"
}
```

### 3.2 Duration Detection

When a recording is stopped and the output file is finalized, the backend must probe the video file to extract its duration and store it in `tapes.duration_ms`. This must use FFprobe (bundled with FFmpeg) via a subprocess call. The operation is best-effort — if it fails, `duration_ms` remains null and the UI must handle that gracefully.

### 3.3 Chapter Export (FFmpeg Split)

Exporting a chapter must use FFmpeg to extract a time-bounded segment from the source recording. Requirements:

- Use stream copy (`-c copy`) to avoid re-encoding — this preserves quality and is fast
- The output filename must follow the pattern: `{SafeTapeLabel}_ch{order:02d}_{SafeChapterTitle}.{ext}`, where `ext` matches the source file extension
- Output files are saved to the same directory as the source recording by default
- If `end_time_ms` is null for a chapter, the end point must be inferred as either the `start_time_ms` of the next chapter (by order) or the end of the file if it is the last chapter
- Export is performed asynchronously; the endpoint returns immediately with a `job_id` and the client polls for completion

### 3.4 Export Job Tracking

To support async export without a task queue dependency, the backend must maintain an in-memory job registry with the following structure per job:

| Field | Description |
|---|---|
| `job_id` | UUID |
| `chapter_id` | Chapter being exported |
| `status` | `pending`, `running`, `done`, or `error` |
| `error` | Error message if status is `error` |
| `started_at` | Timestamp |
| `finished_at` | Timestamp |

Expose a polling endpoint:

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/jobs/{job_id}` | Return current job status and result |

On completion, the backend must update `chapters.output_file` and `chapters.exported_at` in the database.

### 3.5 Validation Rules

The backend must enforce the following on chapter create and update:

- `start_time_ms` must be ≥ 0
- `end_time_ms`, if provided, must be greater than `start_time_ms`
- Chapter time ranges must not overlap with any existing chapter on the same tape
- If `tapes.duration_ms` is known, `start_time_ms` and `end_time_ms` must not exceed it
- A chapter cannot be exported if `tapes.output_file` is null or the file does not exist on disk

---

## 4. Frontend Requirements

### 4.1 Entry Point

The chapter editor is accessed from the Tape Library. Each tape row with status `done` gains a **Chapters** action button alongside Edit and Delete. Clicking it opens the Chapter Editor view for that tape.

### 4.2 Chapter Editor View

The Chapter Editor is a dedicated full-page view (not a modal) for a single tape. It consists of three areas:

#### 4.2.1 Tape Header

Displays the tape label, total duration, output file path, and a count of chapters defined so far.

#### 4.2.2 Timeline

A horizontal visual timeline representing the full duration of the recording. Requirements:

- The timeline spans the full recorded duration (`tapes.duration_ms`)
- Each defined chapter is rendered as a labeled, colored block on the timeline
- Blocks are proportionally sized to their duration
- Gaps between chapters (unlabeled segments) are visually distinct from defined chapters
- Clicking on a chapter block selects it for editing
- If `duration_ms` is unavailable, the timeline is replaced with a plain ordered list of chapters

#### 4.2.3 Chapter List & Editor

A list of all chapters for the tape, each row displaying: order, title, start time, end time, duration, export status, and actions (Edit, Export, Delete).

Times must be displayed in `HH:MM:SS` format. A collapsed inline form allows editing a chapter's title, start time, end time, and notes in place without navigating away.

An **Add Chapter** button opens an inline form at the bottom of the list. The start time field must default to the end time of the last existing chapter, or `00:00:00` if none exist.

### 4.3 Time Input

All timestamp inputs must accept both of the following formats:

- `HH:MM:SS` — hours, minutes, seconds
- `HH:MM:SS.mmm` — with millisecond precision

The input must validate format on blur and display an inline error if the format is invalid or the value fails any validation rule from section 3.5.

### 4.4 Export Controls

Each chapter row has an individual **Export** button. The toolbar at the top of the chapter list has an **Export All** button. Both trigger the async export flow:

- The button changes to a loading/spinner state while the job is running
- The frontend polls `/api/jobs/{job_id}` every 2 seconds until the job reaches `done` or `error`
- On success, the row updates to show the output filename and a checkmark
- On error, an inline error message is shown on the relevant row
- Export All disables individual export buttons for all chapters while running and shows per-chapter progress as jobs resolve

### 4.5 Validation Feedback

All validation errors from section 3.5 must be shown inline next to the relevant field. The save button must be disabled while any field has a validation error. Overlapping chapter ranges must be flagged with a specific message identifying the conflicting chapter by title.

---

## 5. FFmpeg Dependency

FFmpeg and FFprobe must be installed on the host machine and accessible on the system `PATH`. The application must check for their presence on startup and surface a clear warning in the OBS Settings page if either is not found. Chapter export functionality must be disabled in the UI when FFmpeg is unavailable, with a tooltip explaining why.

Recommended installation note for documentation: FFmpeg can be installed via `apt install ffmpeg` on Debian/Ubuntu or downloaded from ffmpeg.org on Windows and macOS.

---

## 6. Example Export Command

For reference, the FFmpeg invocation for a chapter export should follow this form:

```bash
ffmpeg -ss <start_seconds> -to <end_seconds> -i <input_file> -c copy <output_file>
```

Using `-ss` before `-i` (input seeking) is significantly faster than output seeking for large files and is the correct approach for this use case.

---

## 7. Summary of New Components

| Component | Type | Description |
|---|---|---|
| `chapters` DB table | Backend | Stores chapter metadata |
| `tapes.duration_ms` | Backend | Actual recording duration from FFprobe |
| Chapter CRUD endpoints | Backend | Full create/read/update/delete for chapters |
| Export endpoints | Backend | Single and bulk async FFmpeg export |
| Job registry | Backend | In-memory async job tracking |
| FFmpeg/FFprobe check | Backend | Startup validation of system dependencies |
| Chapters button (Tape Library) | Frontend | Entry point to chapter editor |
| Chapter Editor view | Frontend | Full-page editor with timeline, list, and inline forms |
| Time input component | Frontend | Reusable `HH:MM:SS[.mmm]` input with validation |
| Export progress UI | Frontend | Per-job polling and status display |
