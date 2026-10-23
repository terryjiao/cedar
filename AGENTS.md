# Cedar

Cedar is an independent agent experimentation product. DSH is the first supported target runtime; customer names and domain-specific rules belong in project inputs and examples, never in core branching logic.

Before continuing development, read `docs/progress.md`, `docs/next-milestone.md` and `docs/roadmap.md`. They distinguish shipped capabilities, the next milestone and longer-term hypotheses. Verify runtime facts before designing an execution adapter; no concrete DSH automation entry point is established yet. Update these records when milestones complete or scope changes, and keep future capabilities explicitly planned.

The first milestone is evidence-backed onboarding. The developer's existing coding agent performs semantic analysis using `skills/cedar-onboard/SKILL.md`; the CLI collects sources, validates evidence, and renders reports. Do not pretend a static check proves a target runs, or that a test plan measures coverage.

Use Node 22.19+ and TypeScript. Run `npm test` and `npm run check` for code changes, and `npm run test:package` for changes to packaging or the user entry point. Keep target projects read-only during onboarding. Never install or launch target code while collecting context. Add a regression test for changes at filesystem, source-validation, and CLI boundaries.

The public entry is a versioned Skill URL and a prebuilt package on GitHub Releases. Users should not need a Cedar checkout or a developer toolchain. Keep package metadata, the Skill's package URL, README links and release tags consistent. Keep private project inputs, generated reports and internal notes in ignored local storage; use synthetic fixtures in public tests.
