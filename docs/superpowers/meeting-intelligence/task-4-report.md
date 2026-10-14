# Task 4 report: fixed-scope grounded QA and history

## Delivered interfaces

- `createQAService({ prisma, indexer, workspaceRetriever, llm, audit })` exposes `createConversation({ meetingIds, workspaceIds }, userId)`, `getConversation(id, userId)`, `ask(id, { question, previousAnswerId, clarification }, userId)`, and `history(id, userId)`.
- Conversations require 1–10 unique available meetings and at least one unique Workspace. They store those sets once. Ownership is checked on every conversation operation, and Workspace access is resolved again before retrieval or history is returned.
- `createWorkspaceRetriever({ lookupWorkspace, searchWorkspace })` is a concrete authenticated adapter seam. Lookup must return the exact requested workspace; search is run only against those resolved workspaces. It emits evidence IDs scoped to Workspace, strips unrelated adapter fields, and includes a file link only when the search adapter supplied one.
- Each answer reruns meeting and Workspace retrieval. With no current evidence it records `AWAITING_SOURCES` without calling the model. Model output must be structured, cite current evidence IDs, and quote a nonempty substring from the matching evidence. Invalid citations become controlled `FAILED` answers. Provider errors remain distinct from missing evidence; an error with `partialText` is retained as `FAILED_INCOMPLETE`.
- Before generation and within the answer publication transaction, the service captures and compares selected meeting availability, generation, meeting revision time, and each active source ID, hash, parse state, file availability, and revision time. A change records `FAILED_STALE` and blocks the answer. Every answer stores immutable citation and source-state snapshots; history compares those snapshots with current meeting state and returns `stale` and `newSources` flags. Older answers are never fed back as evidence, and reanswers create a new row pointing to the prior answer.
- Audit calls receive the transaction client as their second argument. Audit write errors propagate and roll back the associated conversation or answer transaction.

## Grounding and limits

The prompt treats source text, questions, and clarifications as untrusted data; prohibits outside knowledge and tools; distinguishes decisions from discussion; asks for missing applicability; and requires conflicts to be shown in parallel with citations without choosing an authority. `AWAITING_SOURCES` accepts a cited partial answer when it names what remains missing. Structural checks can verify evidence identity and quote overlap, but they cannot prove that a quote semantically entails every claim in the answer. Model semantic-entailment quality remains a release-set review item.

Meeting file availability is captured from the indexed source's retained `filePath`, but Task 4 does not invent a client URL. Workspace links are preserved only when supplied by the authenticated search adapter. Task 5 must wire the real provider, authenticated Workspace lookup/search, and any supported original-file opening route. Real providers, live Workspace access, and production original-file opening were not available for this task's verification.

## RED/GREEN and checks

- RED: before the modules existed, `npx jest server/__tests__/meetings/qa.test.js server/__tests__/meetings/grounding.test.js --runInBand` failed with the expected missing-module errors.
- Regression RED/GREEN: temporarily bypassing the source-snapshot comparison made `blocks a model result when the source set changes during generation` fail because the stale answer was published; restoring the comparison made the same targeted test pass.
- Focused GREEN: `npx jest server/__tests__/meetings/qa.test.js server/__tests__/meetings/grounding.test.js --runInBand` — 2 suites, 12 tests passed.
- Meeting regression GREEN: `npx jest server/__tests__/meetings --runInBand` — 9 suites, 96 tests passed.
- Scoped ESLint passed for the three implementation modules with zero warnings. The two test paths are excluded by the repository ESLint ignore patterns. Prettier formatted all five Task 4 code and test files.

## Self-review

- Scope, ownership, Workspace accessibility, unavailable meetings, empty and partial retrieval, invalid citations, conflicting evidence presentation, model failure, in-flight source changes, history after source removal, and reanswer linkage have focused coverage.
- Historical snapshots remain readable after a selected meeting becomes unavailable, while new questions are blocked. This preserves history without treating it as current evidence.
- The Workspace adapter has no baked-in AnythingLLM provider implementation. Task 5 owns runtime wiring, including selecting the authenticated Workspace vector search implementation and confirming original-file links.
- Citation quote matching and the prompt reduce fabrication risk but cannot prove entailment or guarantee that a model labels every conflict correctly. Acceptance must include real-provider checks for hallucinations, suggestions presented as approved decisions, and parallel conflicting citations.
