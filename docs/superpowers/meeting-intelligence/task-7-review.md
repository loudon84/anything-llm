# Task7 scoped review — e78814ca

Spec compliance FAIL; quality Needs fixes. No Critical issues; three Important findings.

1. PDF image-mask content bypasses OCR (`server/modules/meetings/parser.js:242-247`). Image operator allowlist omits paintImageMaskXObject/group/repeat. Reviewer actual synthetic PDF native header+mask probe returned only Native header with zero OCR calls. Include actual bundled mask and JPEG operator paths and real mask fixture.
2. PDF callback failure can silently lose content and fabricate page provenance (`parser.js:250,260,272-274`). pdf-parse swallows pagerender exceptions; successful pages are renumbered by array index. Reviewer actual two-page operator-failure probe returned actual page2 as page1. Capture callback failure and reject after parse; retain actual page.pageNumber; failure must block partial publication.
3. Workspace text preview unrendered (`frontend/src/pages/Meetings/SourceViewer.jsx:161-166,245-270`). Fetch sets previewText and clears previewUrl; Workspace branch renders previewUrl only, unlike meeting SourceTextPreview. Render safe text in Workspace branch and cover actual viewer rendering after preview.

Strengths: historicalFILE guard transactional with realPrisma tests; FILE-only quota boundaries; correct history envelope; escaped/sandboxed preview policy; runtime currentmodel/profile/OCR configuration realPrisma/localHTTP integration; test-only explicit datasource and adapters isolation. No unrelated expansion found.

Minor: disclosed existing frontend build externalization/mixed-import/chunk warnings retained; not attributed to Task7/no blocking finding.

Reviewer read supplied diff once; inspected bundled pdf-parse/PDF.js for namedoperator/error risk, ran only two synthetic in-memory focusedprobes; checked embeddingprovider actual model fields for namedcontract risk. No repeated suites, mutations, credentials/services. Accepted actualparentbrowser evidence for meeting TXTpreview only, not Workspace preview. Broaderbranch, Linux/live APIs/providers, semanticquality/OCR accuracy/performance declined as outside scopedreview; remain finalreview/releasegates. Parent ledger/TODO/final review/delivery and fresh generation evidence not part code diff.
