# SSSIHL Result Processor

Web replacement for the Google Sheets + Apps Script result processor used by the Controller of Examinations office.

- `engine/` — the grading engine in plain JavaScript (no dependencies). Same rules as the sheet formulas, plus validation, CGPA and the sheet parsers.
- `app/` — React 19 + Rsbuild frontend and Cloudflare Pages Functions API on D1.
- `tools/` — scripts that build test fixtures from a Result Processor workbook.

## Cycles and sessions

An examination cycle (e.g. April 2026) groups the exam sessions held in it (e.g. ESE Regular, Supplementary). The grouping is for organising only: each session keeps its own sources, marks, runs, approvals and publications. Admins create, rename and delete cycles and move sessions between them on the **Exam sessions** page.

**Supplementary sessions.** A session can be created as a supplementary of one regular session. Load its CMF, SMF, CIE and ESE as usual (fresh CIE and ESE for each re-appearing paper). For each student, the approved result in the base session is taken as it stands and every re-appeared paper replaces the regular one, even when the new attempt is worse (re-appearing in a passed paper is flagged). GPA, grade and CGPA are recomputed in the supplementary session and approved there; the base session is never changed. CGPA uses the supplementary PREV if loaded, otherwise the base session PREV. A student with no approved base result is held and this cannot be accepted. If a base result is corrected later, the supplementary result shows as changed and needs approval again.

**Locking.** An admin can lock a finished session (Exam sessions page). While locked, syncs, uploads, compute, edits, overrides and approvals are refused; the session can still be viewed, exported and moved between cycles.

## Mark sheets (marks straight from teachers' sheets)

Instead of the Fetch CIE / Fetch ESE Apps Scripts and their Tracking and Aggregate sheets, a session can read every teacher's **Marks Statement** directly:

1. On **Mark sheets**, link the CIE course masters (one per campus; the campus is taken from the end of the file name, e.g. `Course_Master-Apr 2026-PSN`) and the ESE course master. The course masters are only read, never changed.
2. **Refresh list from course masters** builds the list of sheets from each row's *Marks File Url* (the old Tracking Sheet).
3. **Fetch marks now** opens each Marks Statement and takes the marks once the teacher has certified it: CIE needs `certifyCell` and `allFilledCell` = Yes; ESE also needs `validationCell` = Yes. Internship papers (code with `-INT` at characters 5–8) are taken row by row as rows are marked ready. The same named cells as the Apps Script template are used, so the template needs no change.
4. Results are recomputed when marks changed. Every morning the daily job checks all sheets again; a mark a teacher changes after it was fetched is recorded as a correction (teachers' files are not locked).

A session takes CIE (or ESE) marks either from Mark sheets or from an aggregate sheet / upload, not both. Statuses shown per sheet: Not checked yet, Teacher still filling, Awaiting validation, Partly fetched, Fetched, Reopened by teacher, No access, Template problem, Data missing, No file in course master. Malpractice changes are made as mark edits on the student page.

## Grade register

Generated automatically from the latest Compute (`engine/src/register.js`), on request, with nothing stored and nothing to upload. It lists only ready results: students with no blocking issues, not held or withheld.

Each student has a name row (Name, Regd. No., Campus, Programme, Semester), a paper table (S.No., Course Code, Course Title, Type, Category, Credits, CIE Marks, ESE Marks, CIE%, ESE%, COMB%, CIE-NP, ESE-NP, COMB-NP, EarnedCred, EarnedCrPoints, Remarks) and totals (Sum of EarnedCred, Sum of EarnedCrPoints, Semester GPA, Letter Grade, Qual Grade). The register goes by programme and semester: students of the same programme and semester are listed together whatever their batch. **Print** prints everyone matching the current programme and search, one A4 landscape page per student, with the institute's header on each page.

- **Find students** takes several Regd Nos or names at once, separated by commas (Regd Nos also by spaces), and shows them together. It says which of them has no ready result.
- Papers are in CMF Sequence order, then course code. Gracing uses the same order.
- A paper's credits and credit points are earned only when it is passed.
- A graced paper shows its graced ESE marks and a "Graced +N" remark.
- Courses with no CIE or ESE (non-credit) are listed for the student's programme, semester and batch, with `--` in the mark columns.

## Result Sheet and Failure List

Port of `Result software.py` without its GUI. Both are built from the latest Compute (ready results only), with **Print** and **Download Word**. Each document has one section per degree, semester and campus; a filter narrows it to a campus, degree, semester, programme or named students.

- **Result Sheet** (A4 portrait): S.No., Regd.No., Name, GPA, Grade, grouped by programme name. A student with a failed paper prints `**Fails**` in place of GPA and Grade, plus `**Absent**` if a paper was missed, with each such paper listed beneath.
- **Failure List** (A4 landscape): a row per paper that Fails or is Absent, showing CIE, ESE and COMB percentages like the old FailureList sheet, followed by the Paper Taught / QP Setter / Examiner table and the Previous University / Previous CGPA table.
- **Editable on the page:** those two tables, saved per session. Paper Taught starts from the CIE mark sheet's teacher and Examiner from the ESE mark sheet's; an edit replaces it. Marks are corrected on the student page.
- **Programme name and degree** come from the CMF (`Programme Name`, `Degree`), with the SMF filling in programmes the CMF does not list. A CMF loaded before this feature must be uploaded again for names to appear; until then the programme code shows.
- **Campus** comes from the SMF, not worked out from the Regd No as the Python did.

## Analytics and Integral Items

- **Analytics** (per session): pass rate, grade distribution, GPA histogram and spread per programme and batch, per-course pass rates and mean CIE/ESE/COMB, and the hardest papers. Each cycle has an overview page comparing its sessions; combined figures count regular sessions only.
- **Integral Items** (per session): port of `populateIntegralItems`. Upload the "Integral Items-Data Entry" workbooks (the **Consolidated** tab of each is read) or link the sheets and sync. Same rules as the sheet, including a blank, text or 0 item becoming `X`. Download as `integral.csv`. It is a report only and does not affect GPA.

## How results move

Each Programme × Semester × Batch is a batch. Students in a batch move independently:

| Status | Meaning |
|---|---|
| Held | A blocking issue (missing mark, unreadable mark, unknown paper…) — see Issues |
| Withheld | Credits do not match SMF Sem-Credits |
| Ready | Computed with no blocking issue, waiting for approval |
| Approved | Signed off by an admin — the final step; there is no separate publishing |
| Changed since approval | Marks or rules changed after approval — needs approval again |

Every sync records corrected marks, every compute is a stored run you can compare with the previous one, and every override needs a reason and appears in the audit trail.

## Gracing

Applied automatically on every compute (`engine/src/grace.js`), before the student's GPA and status are worked out.

- **Pool:** 1% of the total ESE maximum of the student's papers. Viva and project papers count; internal-only and non-credit papers do not.
- **Papers:** failed papers with Course Type `Theory` in the CMF and an ESE, within 3 points below a pass mark (37 to 39 at 40, 47 to 49 at 50). Spent in CMF Sequence order, then course code; a paper the pool cannot cover fails and the next is still tried.
- **ESE grace:** ESE goes to its pass mark, only if the paper then passes on COMB. Costs the ESE shortfall.
- **COMB grace:** otherwise ESE is raised just enough for COMB to reach its pass mark, CIE untouched. Costs the COMB shortfall. Shortfalls cost that share of the ESE maximum, so 2 points on a paper out of 50 cost 1 mark.
- **Supplementary:** the first UG attempt gets the pool less the grace used in the regular exam. The terminal attempt (UG second, PG and professional first) gets a fresh pool. The attempt number is the session's place among the regular session's supplementaries, by creation date.
- **PG E1, E2 and TEB:** the portal holds only the final ESE mark, so grace applies to that and the note on the paper says to add it to E1 or TEB. Teachers' sheets are never changed.

Every graced paper is listed under Issues, Notes, Grace applied. A borderline paper with a blank Course Type raises a warning instead of quietly failing.

## Policies that differ from the sheet

- A missing CIE/ESE mark makes the paper **Pending** (student held) instead of **Fails**.
- An unreadable mark holds the student. A mark above the CMF maximum is only a warning and is graded as given (as in the old Rule 3B).
- Only the incomplete students are held; the rest of the batch can be approved.
- CIE/ESE weighting comes from the CMF `CIE WTG` / `ESE WTG` columns per course (B.Ed is 30/70).
- An `_IHA` row in the CMF (a SWAYAM paper's in-house assignment) adds its credits to the paper of the same code, once even when programmes share the paper, and that paper is graded on its one set of marks. The sheet dropped these credits, which left students short of their Sem-Credits. A CMF loaded before this rule must be uploaded again.
- Each student's expected papers come from the CMF. A course nobody in the batch has marks for blocks the batch; a course only some students have marks for is a warning and nobody is held for it (as in the old Rule 1B). The low-mark warning (20% of the maximum) can be changed per session under **Grading rules → Completeness rules**.
- **Completeness** shows the old completeness report section by section (Rule 0 to detained students). Unlike the old script, a hard block holds only the students it affects, or the whole batch when the problem is with the batch.
- Hand-typed values in the sheet become explicit overrides. On a student's page an admin can click a CIE or ESE mark, a student detail (name, campus, batch, Sem-Credits) or **Edit course values** to change it. Each edit needs a reason, is kept in the audit trail with the sheet's value, stays in force after the next sync, and recomputes the result; **Revert to sheet** undoes it.

## Demo data

`node tools/make_demo_data.mjs` writes invented Excel files to `demo/`: a regular session for 110 students in three programmes with planted problems (`1-regular`), the corrected files that clear them (`2-corrections`), and a supplementary for the students who failed (`3-supplementary`). Upload them on **Data sources**.

## Staying under the D1 daily limits

The free plan allows 100,000 rows written and 5 million rows read a day, resetting at 5:30 am IST. Past that, saving fails until the reset and the API says so.

- **Write only what changed:** marks, CIE / ESE tab rows, issues, batches and the mark sheet list are compared with what is stored first.
- **A Compute that changes nothing saves nothing:** the latest run stands and the page says nothing changed. A Compute that changes anything saves every student again (about 3,300 rows written for 1,600 students).
- **Avoid counting or scanning big tables on page loads,** and check what a one-off query costs before running it on live: a query scanning `marksheets` for each paper read over 600,000 rows.
- **Check usage** with `npx wrangler d1 info result-processor` and `npx wrangler d1 insights result-processor --sort-by=writes --sort-type=sum --timePeriod=1d`.

## Tests

```bash
cd engine
npm test
```

Golden tests run only when `fixtures/` exists. Build fixtures from any Result Processor workbook (Python with openpyxl):

```bash
python3 tools/extract_fixtures.py "Result_Processor ESE-April-2026.xlsx" fixtures
```

On the April 2026 workbook the engine reproduces all 12,642 Consolidated Result rows and all 1,572 FinalOutput results exactly.

## Run locally

```bash
cd app
npm install
cp .dev.vars.example .dev.vars        # set DEV_USER_EMAIL
npx wrangler d1 migrations apply result-processor --local
npm run build
npx wrangler pages dev dist --port 8788
```

Open http://127.0.0.1:8788, create a session, and either link Google Sheets or upload the CMF, SMF, CIE and ESE files from **Data sources**.

For frontend work run `npm run dev` alongside `wrangler pages dev` and open http://localhost:5173 (Rsbuild hot-reloads and proxies `/api` to port 8788).

## Deploy to Cloudflare

1. Create the database and put its id in `app/wrangler.toml`:
   ```bash
   npx wrangler d1 create result-processor
   npx wrangler d1 migrations apply result-processor --remote
   ```
2. Create the Pages project and deploy:
   ```bash
   npm run deploy
   ```
3. Google service account (Google Cloud console → IAM → Service accounts): create one, enable the Google Sheets API, create a JSON key, then:
   ```bash
   npx wrangler pages secret put GOOGLE_SA_EMAIL
   npx wrangler pages secret put GOOGLE_SA_KEY      # the private_key value from the JSON
   ```
   Share the CMF, SMF, CIE and ESE spreadsheets with the service account email as Viewer. For **Mark sheets**, also share the course masters and the folder holding the teachers' Marks Statements (Viewer is enough).
4. Sign-in: put the Pages domain behind Cloudflare Zero Trust Access with a Google identity provider limited to `sssihl.edu.in`. The API reads the `Cf-Access-Authenticated-User-Email` header.
5. Set `ADMIN_EMAILS` in `wrangler.toml` (comma separated). Everyone else starts as a viewer; admins change roles under **People**.
6. Daily Mark sheets check (optional): put the same D1 `database_id` in `app/cron/wrangler.toml`, then from `app/`:
   ```bash
   npx wrangler secret put GOOGLE_SA_EMAIL --config cron/wrangler.toml
   npx wrangler secret put GOOGLE_SA_KEY   --config cron/wrangler.toml
   npx wrangler deploy --config cron/wrangler.toml
   ```
   It runs every 10 minutes between 05:30 and 08:20 IST and checks each open session's sheets once a day.

A full-session compute of ~1,600 students takes about 1–2 seconds of CPU, so use the Workers Paid plan (the free plan's 10 ms CPU limit is too small).

## Not yet covered

- CGPA status rules (`COMPUTED` / `WITHHELD` / `NOT_APPLICABLE`) are provisional; the arithmetic matches the CGPA Result sheet. Confirm against `runCGPAEngine`.
- Tabulation register: waiting for the office format.
- Integral Items cannot list a Drive folder; upload the workbooks or link each sheet.
- A supplementary of a supplementary is not supported; a second supplementary builds on the regular result only.
