---
name: pre_deploy_checks
description: What to verify before pushing and calling something deployed/working
type: feedback
---

Before pushing any feature and declaring it deployed, always:
1. Run `npm run build` locally to catch compile/TypeScript errors
2. Trace the full request path: proxy.ts → layout → page → API, reading each relevant file
3. Check proxy.ts PUBLIC_PATHS to confirm new public routes are whitelisted
4. Read every file that could intercept navigation, not just the file being edited

**Why:** Pushed a UI fix for a broken link multiple times before discovering the real issue was that proxy.ts (this app's auth guard / middleware equivalent) was blocking /get-started for unauthenticated users. The navigation kept redirecting to /login silently.

**How to apply:** For any navigation, form submission, or new public page: read proxy.ts, layout.tsx, and any auth lib before writing code. Run `npm run build` before pushing. Do not say "deployed correctly" without having verified the logic end-to-end.

**Project-specific:** This Next.js version uses proxy.ts (not middleware.ts) as the request proxy/middleware file. Do NOT create middleware.ts — it will cause a build error.
