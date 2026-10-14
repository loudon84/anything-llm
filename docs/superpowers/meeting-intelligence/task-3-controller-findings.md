# Task3 controller supplemental findings

8. Required PPT image OCR is omitted: parser.js pptxSlides extracts a:t text only and never inspects embedded media/relationships. A slide with text plus a screenshot succeeds but screenshot text is never processed even with services.ocr configured. Parse the embedded image evidence with its slide provenance, or send whole PPT to configured located parser when image content is present; missing required OCR must fail clearly, not silently skip. Add slide containing both native text and image fixture.

9. Mixed text/scanned PDF skips the scanned pages: pdfPages filters empty text pages, and parse returns successful local segments when any page has text. A text page followed by scanned page never reaches OCR. Preserve empty-page identities for classification, process those pages through configured OCR (or whole-document OCR with validated page locations), and test mixed two-page PDF. Do not treat absent text extraction as proof that page is blank.

Ruling on finding7: A standalone image source is already identified by its source ID/file, so location.type=image can refer to the whole asset without invented crop bounds. Require format-specific type and real PDF page/PPT slide IDs; do not add unsupported pixel-box requirements to PRD.
