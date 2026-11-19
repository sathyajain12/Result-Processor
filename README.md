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
4. Compute results after marks change (the page does it after a Fetch; the morning check only marks that marks changed). **Fetch** reads only sheets not fetched yet (new, still filling, reopened, partly fetched or with a problem) and skips those already fetched. Every morning the daily job checks all sheets again, fetched ones included, so a mark a teacher changes after it was fetched is still recorded as a correction (teachers' files are not locked).

**SLD students.** A student with a Specific Learning Disability writes a separate paper with its own Marks Statement, whose course code ends in SLD (`UPOL-101_SLD`, `UELL-502-SLD`). Its marks count for the paper itself (UPOL-101), graded out of the SLD sheet's own maximum (from the course master's max column, else the sheet), so 37 out of 60 is 62%. This acts like an "Edit course values" change of the ESE maximum for that student, made automatically at Compute; an edit on the student page still wins. The Grade register remarks "SLD (ESE out of 60)".

**Fetch now (one course).** Each sheet on the Mark sheets page has a **Fetch now** button for operators, for when one course's marks are needed straight away. It reads that one Marks Statement immediately, under the same rules: marks are taken only once the sheet is certified (and validated, for ESE); otherwise only its status is refreshed. An already fetched sheet is read again, so later corrections come in too. If any mark changed, results are recomputed. Each use is recorded under Sources and fetches and in the audit log.

A session takes CIE (or ESE) marks either from Mark sheets or from an aggregate sheet / upload, not both. Statuses shown per sheet: Not checked yet, Teacher still filling, Awaiting validation, Partly fetched, Fetched, Reopened by teacher, No access, Template problem, Data missing, No file in course master. Malpractice changes are made as mark edits on the student page.

## Morning summary

**Mark sheets → Morning summary** (`marksheets/summary.js`, `src/pages/MorningSummary.jsx`) shows what one morning check found, today's by default; earlier checks are in the date list, and each morning check under Recent fetches links to its summary. The check runs 05:30–15:30 IST, two sheets a minute, so today's summary fills in through the day.

- **Corrections to approved results** first: marks a teacher changed after the student's result was approved, with what to do (compute, then approve again).
- **Need attention:** sheets that could no longer be read (no access, template problem, data missing), with the error.
- **All corrections**, grouped by the teacher's sheet: Regd No, name, the mark before and after, the effect on the result, the student's result, and what to do.
  - **Sheet and teacher:** each group names the campus and the teacher (name and address, from the course master, shown as text only: nothing sends email) and has an **Open sheet** link to the Marks Statement. The sheet is found from the student's row on the CIE / ESE marks list, or, for a student removed from a sheet, the sheet with that paper code in the same check.
  - **Effect on the result:** the paper's status, COMB %, GPA and grade in the Compute just before the correction and in the latest Compute, once one has run after it, e.g. "Pass to fail: Paper Pass → Fails · COMB 52% → 48% · GPA 7.1 → 6.4". A paper that turns from pass to fail is red and counted at the top; fail to pass is green. Before a Compute it shows the result before the correction and "Compute to see the effect". The database unpacks only the corrected students' papers.
  - **Reviewed:** operators tick a correction once it has been checked against the teacher's sheet, or **Tick all** for a sheet; unticking is allowed. Each tick records who and when (`correction_reviews`, migration 0028, `marksheets/review.js`) and a `review-corrections` entry in Runs and audit. **Hide reviewed** leaves only the open ones. The Batches banner counts corrections not reviewed yet, and is red only for approved results whose corrections are not reviewed.
- **New marks** (sheets certified since the previous check), **Reopened by teachers**, **Problems cleared**, and other status changes.
- The **Batches** page has a one-line banner for the latest check, red when approved results are affected or a sheet needs attention. It is shown to people with the Mark sheets tab.

Each check writes a `marksheet_events` row (migration 0027) only for a sheet whose status or marks changed, so re-reading unchanged sheets writes nothing. Corrections are read from `mark_changes` by run through a new index. Checks from before migration 0027 show their corrections, but not their sheet changes.

## Failures

The **Failures** tab (under Release) lists every failed or absent paper in the latest Compute, grouped by batch:

- **Each row:** the student, the paper, its CIE, ESE and COMB marks, where it was lost (Failed in CIE / ESE / both, on the combined mark, or Absent in CIE / ESE) and the student's status.
- **Who is included:** students whose result is still pending are listed too, because a paper they failed has its marks.
- **Filters:** programme, campus, semester, paper, failed or absent, status and search.
- **CSV download:** one row per paper.

Nothing is stored: the list is read from the latest results, and the database picks out the failed papers so the request stays inside the free plan's CPU limit.

## Gracing

The **Gracing** tab (under Release) lists every paper graced in the latest Compute, grouped by batch:

- **Each row:** the student, the paper, CIE, the ESE before and after grace, the kind of grace (ESE or COMB) with the marks added, the COMB % after grace, the student's grace pool (used of pool, and what is left) and their status.
- **Pool used up:** papers that were close enough to grace but the student's pool could not cover them are listed separately; they stay failed.
- **Filters:** programme, campus, semester, kind of grace, status and search. **CSV download:** one row per graced paper.

The grace rules are on the Grading rules page.

## Grade register

Generated automatically from the latest Compute (`engine/src/register.js`), on request, with nothing stored and nothing to upload. It lists only ready results: students with no blocking issues, not held or withheld.

Each student has a name row (Name, Regd. No., Campus, Programme, Semester), a paper table (S.No., Course Code, Course Title, Type, Category, Credits, Weightage (CIE/ESE), CIE Marks, ESE Marks, CIE%, ESE%, COMB%, CIE-NP, ESE-NP, COMB-NP, EarnedCred, EarnedCrPoints, Remarks) and totals (Sum of EarnedCred, Sum of EarnedCrPoints, Semester GPA, Letter Grade, Qual Grade). The register goes by programme and semester: students of the same programme and semester are listed together whatever their batch. **Print** prints everyone matching the current programme and search, one A4 landscape page per student, with the institute's header on each page.

- **Printed from the portal** (a panel on the page, loaded only when opened): every print made with the **Print** button is recorded when the print dialog opens, as a Runs and audit entry `print-register` (`register/printed.js`): who, when, the programme and semester or "All programmes", any search, how many students and their Regd Nos, and when those results were computed. The browser does not say whether the person then printed or cancelled, so it records the dialog. The panel also lists the programmes with ready results not printed yet. Prints are recorded even in a locked session. Registers made with the Excel tool are not recorded.
- **Find students** takes several Regd Nos or names at once, separated by commas (Regd Nos also by spaces), and shows them together. It says which of them has no ready result.
- Papers are in CMF Sequence order, then course code. Gracing uses the same order.
- **Gracing.** A graced paper's ESE Marks are the graced marks, and its Remarks say `Graced +3 (ESE)` or `Graced +1 (COMB)`. A student with grace also gets a **Gracing** table under the totals. It states the pool: 1% of the semester's total ESE maximum, how much was used and how much is left, and for a supplementary the attempt and what the regular exam used. Then, for each graced paper: the grace type, the calculation ("ESE pass 50% − 46.67% = 3.33 points", "3.33 × 75 ÷ 100 = 2.5, rounded up to 3 marks": the shortfall in points costs that share of the ESE maximum), the grace marks taken from the pool, ESE marks, ESE % and COMB % before and after, COMB-NP, and "Passed with grace". The COMB % before is the exact figure grace was decided on (stored as `combFromPct`); runs from before 17 Nov work it out from the CIE % and the ESE % before grace. For COMB grace the ESE rises by more than the marks taken from the pool, because the pool pays only the COMB shortfall. A failed paper the pool could not cover is listed too: "Not graced: needed 3 grace marks, but only 1 was left in the pool", with "Not graced: pool short" in its Remarks. These come from the GRACE_NOT_AVAILABLE issues, looked up only for the students on the page.
- A paper's credits and credit points are earned only when it is passed.
- Weightage is the CIE/ESE split the paper was graded with at the latest Compute (e.g. 25/75, 100/0 for CIE-only): an edit on the student's page, else the CMF's CIE WTG / ESE WTG, else the course's weightage category.
- A graced paper shows its graced ESE marks and a "Graced +N" remark.
- Courses with no CIE or ESE (non-credit) are listed for the student's programme, semester and batch, with `--` in the mark columns.

## Analytics and Integral Items

- **Analytics** (per session): pass rate, grade distribution, GPA histogram and spread per programme and batch, per-course pass rates and mean CIE/ESE/COMB, and the hardest papers. Each cycle has an overview page comparing its sessions; combined figures count regular sessions only.
- **Integral Items** (per session): port of `populateIntegralItems`. Upload the "Integral Items-Data Entry" workbooks (the **Consolidated** tab of each is read) or link the sheets and sync. Same rules as the sheet, including a blank, text or 0 item becoming `X`. Download as `integral.csv`. It is a report only and does not affect GPA.

## Who can open which tab

**By invitation only.** Only people listed on the People page can sign in. Anyone else, even with an institute account, sees "You have not been given access" and is not added to the list. The admin addresses in `ADMIN_EMAILS` are added as admins at their first sign-in.

On the **People** page an admin chooses, per person, either **every tab** (the default) or **only some tabs**: Data sources, Mark sheets, Integral Items, Batches, Completeness, Issues, Analytics, Final output, Failures, Gracing, Grade register, Runs and audit, Grading rules, and Student pages (the student search and each student's page).

- **Role and tabs together:** the role (viewer, operator, admin) still decides what a person can do. The tabs decide where they can go.
- **Admins** always see every tab.
- **The menu** shows only a person's own tabs. Any other tab's address shows a "no access" page, and the server refuses that tab's data too (`shared/tabs.js`, checked in `api/sessions/[sid]/_middleware.js`).
- **Someone without Batches** starts on their first tab, and the session summary they receive carries no batch list.
- **Remove access:** each person also has **Remove access**, which shuts them out at once and keeps them out at every sign-in (migration 0022). Removed people are listed under **Access removed**, where **Restore access** gives back their role and tabs. Admins cannot remove themselves. Both actions are recorded in the audit log.

## How results move

Each Programme × Semester × Batch is a batch. Students in a batch move independently:

| Status | Meaning |
|---|---|
| Pending | Not finished yet: a blocking issue (missing mark, marks still to come, unreadable mark, unknown paper…) — see Issues. Stored as "Held". |
| Withheld | Credits do not match SMF Sem-Credits |
| Ready | Computed with no blocking issue, waiting for approval |
| Approved | Signed off by an admin — the final step; there is no separate publishing |
| Changed since approval | Marks or rules changed after approval — needs approval again |

**Campuses.** When a programme is taught on more than one campus, the Batches board shows each campus under its batch. A campus is listed as **ready** once every one of its students is ready (or withheld). Otherwise it shows how many are pending and how much of its marks have arrived. The **Campus ready** filter lists batches where one campus is ready while another is still pending, and Completeness names the ready campus too. A campus's students can be approved without waiting for the other campus.

Every sync records corrected marks, every compute is a stored run you can compare with the previous one, and every override needs a reason and appears in the audit trail.

## Gracing

Applied automatically on every compute (`engine/src/grace.js`), before the student's GPA and status are worked out.

- **Pool:** 1% of the total ESE maximum of the student's papers. Viva and project papers count; internal-only and non-credit papers do not.
- **Papers:** failed papers with Course Type `Theory` in the CMF and an ESE, above the pass mark less 4 and below the pass mark: the Gracing Policy's "> 36% and < 40%" (36.01% to 39.99% at 40, 46.01% to 49.99% at 50). The range and the shortfall use the **exact** percentage of the marks, to two decimals: 35 out of 75 is 46.67%, not the 47% the marks sheet shows (the user's decision, 17 Nov 2026). Whether a paper passes still goes by the sheet's rounded percentages. Spent in CMF Sequence order, then course code; a paper the pool cannot cover fails and the next is still tried.
- **ESE grace:** ESE goes to its pass mark, only if the paper then passes on COMB. Costs the ESE shortfall.
- **COMB grace:** otherwise ESE is raised, a whole mark at a time, to the lowest mark at which the paper passes with COMB rounded as the sheets do (CIE 52, ESE 42 at 50/50: COMB 47, so ESE 47 and COMB 49.5, shown as 50; the user's choice, 17 Nov 2026). CIE is untouched. Costs the COMB shortfall. Shortfalls cost that share of the ESE maximum, so 2 points on a paper out of 50 cost 1 mark, and 3.33 points on one out of 75 come to 2.5. Grace is then given in **whole marks, rounded up** (the user's decision, 17 Nov 2026), so the pass mark is still reached: 2.5 becomes 3 and ESE grace raises the ESE by 3 (35 to 38 out of 75, 50.67%), as the office's other processor does. The pool keeps its decimals (3.25).
- **Supplementary:** the first UG attempt gets the pool less the grace used in the regular exam. The terminal attempt (UG second, PG and professional first) gets a fresh pool. The attempt number is the session's place among the regular session's supplementaries, by creation date.
- **PG E1, E2 and TEB:** the portal holds only the final ESE mark, so grace applies to that and the note on the paper says to add it to E1 or TEB. Teachers' sheets are never changed.

Every graced paper is listed under Issues, Notes, Grace applied. A borderline paper with a blank Course Type raises a warning instead of quietly failing.

## Policies that differ from the sheet

- A missing CIE/ESE mark makes the paper **Pending** (student held) instead of **Fails**.
- An unreadable mark holds the student. A mark above the CMF maximum is only a warning and is graded as given (as in the old Rule 3B).
- Only the incomplete students are held; the rest of the batch can be approved.
- CIE/ESE weighting comes from the CMF `CIE WTG` / `ESE WTG` columns per course (B.Ed is 30/70).
- An `_IHA` row in the CMF (a SWAYAM paper's in-house assignment) adds its credits to the paper of the same code, once even when programmes share the paper, and that paper is graded on its one set of marks. When that paper is CIE-only (no ESE), the `_IHA` CIE maximum is added as well, once: `UCES-001(ugc26_ge10)` is 50 + 50, so its CIE is out of 100. A paper with an ESE, such as a SWAYAM portal exam at CIE 25 / ESE 75, keeps its own maximums. The sheet dropped these credits, which left students short of their Sem-Credits. A CMF loaded before this rule must be uploaded again.
- Each student's expected papers come from the CMF. A course nobody in the batch has marks for ("Course not received") holds only the students who may need it: a student whose credits already match their SMF Sem-Credits and who has no issue of their own goes ahead, so one campus can be released while another waits for a course. The batch is blocked only when that holds everyone; a course only some students have marks for is a warning and nobody is held for it (as in the old Rule 1B). The low-mark warning (20% of the maximum) can be changed per session under **Grading rules → Completeness rules**.
- **Completeness** shows the old completeness report section by section (Rule 0 to detained students). Unlike the old script, a hard block holds only the students it affects, or the whole batch when the problem is with the batch.
- Hand-typed values in the sheet become explicit overrides. On a student's page an admin can click a CIE or ESE mark, a student detail (name, campus, batch, Sem-Credits) or **Edit course values** to change it. Each edit needs a reason, is kept in the audit trail with the sheet's value, stays in force after the next sync, and recomputes the result; **Revert to sheet** undoes it.

## Demo data

`node tools/make_demo_data.mjs` writes invented Excel files to `demo/`: a regular session for 110 students in three programmes with planted problems (`1-regular`), the corrected files that clear them (`2-corrections`), and a supplementary for the students who failed (`3-supplementary`). Upload them on **Data sources**.

## Staying under the D1 daily limits

The free plan allows 100,000 rows written and 5 million rows read a day, resetting at 5:30 am IST. Past that, saving fails until the reset and the API says so.

- **Write only what changed:** marks, CIE / ESE tab rows, issues, batches and the mark sheet list are compared with what is stored first.
- **A Compute that changes nothing saves nothing:** the latest run stands and the page says nothing changed. A Compute that changes anything still grades everyone, because the completeness checks come from grading, and stores a full new run. It sends only the students whose result changed. Each result carries a fingerprint (`row_hash`, migration 0020), and the database copies the unchanged ones from the latest run (`calc/carry`). So after one course's marks come in, saving takes a few requests instead of about 80. The rows written are the same as before: about 3,300 for 1,600 students.
- **Avoid counting or scanning big tables on page loads,** and check what a one-off query costs before running it on live: a query scanning `marksheets` for each paper read over 600,000 rows.
- **The CIE / ESE marks list reads less.** It used to read all of a component's rows (about 12,000 for CIE) five times on every load, page change and refresh during a fetch, about 4 million rows a day. Now:
  - the total and filter lists come from `marksheet_row_groups` (migration 0024). It holds a count per sheet, course, campus and programme, about 1,300 rows, and is rebuilt for a sheet whenever that sheet's rows change. Only a search or the "with remarks" filter still counts the marks rows themselves;
  - page changes ask for the rows only (`lite=1`) and keep page 1's total and lists;
  - an index (migration 0023) lets a page read only up to its own rows;
  - during a fetch, the marks list reloads at most once a minute and the sheet list at most every 30 seconds;
  - each fetch step after the first only checks whether any sheets are left, instead of counting them;
  - a search finds the Regd Nos and course codes that **begin with** what was typed, through indexes (`marksheet_rows_regd`, migration 0026, and `marksheet_rows_list`), and reads only the matching rows. It used to match anywhere (`LIKE '%…%'`), which read every row of the component twice per search: about 3 million rows on 16 Nov, 60% of the day. A code with `noc` in the middle, such as `UMAT-704(noc26_ma102)`, is found by its start (`UMAT`) or with the Course filter;
  - "With remarks" starts from the active mark edits and reads only their rows.
- **The Grade register reads one programme, not the whole run.** The programme list and counts come from the batches written by the same Compute (about 90 rows), not from counting every result (about 3,300 rows on each load). A chosen programme's students are found through the batch index (`batch_key` begins `programme|semester|`). Without a search, the total comes from the batch counts. A search starts from its matches: Regd Nos that begin with a term, through the results' key, and for a term with letters the names containing it (the 1,634 student names, read once). A Regd No search reads about 4 rows instead of about 7,000.
- **Completeness reads what Compute stored.** Rule 1A, "No fetch data" and student names need every mark, student and course: about 18,000 rows. Compute now works these out once and stores them with the run (`runs.arrival`, migration 0025, `arrivalPart` in `shared/completeness-core.js`). Pending counts come from the batch stats. Opening the report reads about 6,000 rows (mostly the issues list) instead of about 24,000. Runs from before this change still use the old way until the next Compute. "Check now" still grades everything, as Compute does.
- **When the limit is reached, pages still show data.** Each page read is kept as a copy in the browser (IndexedDB, `src/lib/offline.js`). When the database refuses (`503` with `details.dbLimit`) or the server can't be reached, the page shows the last copy, with a red banner saying when it was saved. Pages never opened in that browser can't be shown, and nothing can be saved. Compute's paged reads and CSV downloads are never copied. Signing out deletes the copies.
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
   It runs every minute between 05:30 and 15:30 IST, 2 sheets a run (the free plan's 10 ms of CPU), and checks each open session's sheets once a day. It only fetches; Compute runs in the browser.

**Cloudflare's free plan** allows each request only 10 ms of CPU, and grading ~1,600 students takes 1–2 seconds. So **Compute runs in the browser** (`src/lib/compute.js`): it downloads what grading needs in pages (`/calc/inputs`), grades with the same code the server uses (`shared/compute-core.js`), and saves the results back in small pieces (`/calc/start`, `results`, `batches`, `exceptions`, `finish`). A Compute that changes nothing is recognised by a fingerprint of all results and saves nothing. Completeness' **Check now** grades in the browser the same way and saves nothing. The daily job only fetches marks; the portal shows that marks changed until someone clicks Compute results. Keep each request's work small: the server's `POST /compute` (everything in one request) is only for a local server without the limit.

## Not yet covered

- CGPA status rules (`COMPUTED` / `WITHHELD` / `NOT_APPLICABLE`) are provisional; the arithmetic matches the CGPA Result sheet. Confirm against `runCGPAEngine`.
- Tabulation register: waiting for the office format.
- Integral Items cannot list a Drive folder; upload the workbooks or link each sheet.
- A supplementary of a supplementary is not supported; a second supplementary builds on the regular result only.
