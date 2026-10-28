# Feature comparison: Meeting Intelligence / Gateway branches

Read-only comparison of the root checkout and three registered worktrees. No gateway was contacted and no code was changed.

## Recommendation

**The meeting-intelligence-3204 worktree contains the broadest and most complete implementation of the requested meeting features.** It is the best integration source among the available versions, but it is a large dirty worktree, not a single ready branch: its HEAD is 75d35115, while meeting UI, callback, Gateway client/import, migrations, tests and documentation include many uncommitted and untracked files. The root checkout at 1336d327 contains none of these feature files. meeting-gateway-r1 at c73dce7 is an earlier ancestor and has no complete feature slice.

Do not call any version fully verified for real Gateway import. The implementation notes report passing local focused tests/build and SQLite migration checks, while explicitly leaving live R1/R2 content acceptance unverified. “Code-complete for local verification” is supportable; “ready and proven against the actual Gateway” is not.

## Worktree comparison

| Worktree | HEAD / state | Feature assessment |
|---|---|---|
| Root E:/git/anything-llm | 1336d327; unrelated dirty engineering docs/dependencies | No Meeting Gateway feature implementation present. |
| meeting-gateway-r1 | c73dce7c; only untracked dependency/storage files | Earlier ancestor snapshot; OAuth/worker references exist, but no full requested UI, table, importer or callback slice. |
| gateway-qr-login | 75d35115; employee-auth changes are dirty/uncommitted | Has a distinct employee-credentials login flow and tests. Does not contain the broad meeting UI/import work. |
| meeting-intelligence-3204 | 75d35115; 43 tracked files changed plus many new files | Broadest implementation: meeting UI, Gateway redirect OAuth/callback, list/detail/participants, importer, migrations and tests. Deletes the employee-credentials flow present in the QR worktree. |

Both feature worktrees based on 75d35115 have working-tree-only changes; neither has a committed feature version. The branch names therefore overstate their completion. The QR version's employee-auth work and the broad version's redirect OAuth are different Gateway authorization approaches, not duplicate copies of the same change.

## Requested feature coverage in meeting-intelligence-3204

- **Local and Tencent meeting tabs:** present in new MeetingSourceTabs.jsx and Meetings page integration.
- **Callback and automatic save:** /meetings/done callback route is wired in main.jsx; callback completion persists through the authenticated backend flow and refreshes the meeting view.
- **Same-tab login and logout/status controls:** present in the Meetings header. The broad version uses a Gateway-hosted redirect authorization flow; status polling is set to 60 seconds.
- **Live meeting query:** client sends selection: USER_WINDOW; the UI converts the selected Shanghai/CST time range to Unix seconds. A fresh server-side directory-run UUID is created for each query. The UI clears prior results before querying and also clears them on query failure. No explicit query ID is sent to Gateway; if “per-query fresh IDs” means an upstream correlation ID, that is not implemented.
- **Tencent meeting table:** new table component supports the requested page-size controls and meeting details. Participant rows include join name and join time; multiple record files are grouped for detail with deduplicated IDs; detail drawer is 60vw and file choices are sorted TXT/DOCX/PDF first.
- **Meeting identity and links:** server DTO includes meetingCode; canonical path helpers resolve meeting code to the local meeting identifier where needed.
- **Content importer:** backend queue/worker, R1 pagination and record-file deduplication, R2 descriptor handling, download/parse, local meeting linkage, source ledger, owner checks, retry/status and separate reindex are present in source. In the current code, repeated source origins reuse their persisted parsed source bytes, addressing an earlier review concern about mixing changed content with existing provenance.

## Material gaps and consolidation decisions

1. **Real import remains unproven.** The implementation plan's execution outcome records local test/build and SQLite migration success, but no live Gateway import with a generated recording, summary and transcript. Keep this as a release gate; do not say “fully working.” The status-directory refresh helper retains the last successful rows if that background refresh fails, though a new USER_WINDOW query clears visible results before starting and on failure.
2. **Employee-auth behavior is a product/API fork.** gateway-qr-login supplies employee username/password login and a QR authorization popup via EmployeeLoginEntry.jsx, EmployeeCredentialsForm.jsx, and /meeting-gateway/employee-login. meeting-intelligence-3204 removes those files and instead starts Gateway-hosted OAuth authorization via /api/v1/oauth/authorizations, with same-tab callback and local bridge-session completion. Pick the intended supported Gateway contract before consolidation; merging both blindly risks duplicate or conflicting authentication flows. If employee credentials are required, that QR work must be deliberately ported and reviewed against the broad branch's session/security model.
3. **No feature commit exists.** The broad tree includes logs, a temporary SQLite file, and an isolated task directory among untracked items. These are not product changes and should not enter the eventual commit. Commit lineage should be reconciled separately from this source-level audit.
4. **Current review notes still limit the evidence to fixtures/local checks.** The employee OAuth verification doc says tests do not prove live authorization or deployed proxy log configuration.

## Suggested source-of-truth

Use meeting-intelligence-3204 as the feature-comparison baseline for integration, subject to explicit employee-auth decision and live Gateway acceptance. Treat gateway-qr-login as a separate, targeted implementation to selectively port only if username/password Gateway login is still required. Root checkout and meeting-gateway-r1 do not contain a complete version of the requested feature set.
