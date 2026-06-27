M-001B: Define the hosting boundary

Questions we'll answer:

Does C3 expose itself as an embeddable application?
How should the SPFx host mount it?
What's the clean contract between the host and the app?

M-001B: Embeddable Application

Acceptance criteria:

✅ Single application bootstrap
✅ Host-independent entry point
✅ Vite uses bootstrap API
✅ Build remains green
✅ No UI regressions

🎉 Milestone M-001B Complete

I would actually record this as one of the most important milestones in the project so far.

Runtime Architecture
Browser / SPFx
        │
        ▼
mountC3()
        │
        ▼
Host
        │
        ▼
App

That architecture is now established.