@AGENTS.md

# Help Doc Sync Rule

ANY change to user-facing behavior, permissions, features, error messages, or empty states MUST update the mapped help doc(s) in `lib/agents/knowledge/` as part of the same change. Each help doc has YAML frontmatter listing its `sources:` (the code files it documents). If you change a source file, update every doc that lists it.

Specifically:
- Adding/removing/changing a permission check → update the doc's permissions section
- Changing an error message → update the troubleshooting doc
- Adding a new feature → add a new doc or update the relevant one
- Changing a role visibility rule → update roles-permissions.md AND the feature doc
- Bump the `verified:` date in frontmatter when you confirm the doc matches current code

If you're unsure a doc claim is still accurate after your change, mark it `TODO-VERIFY` so it gets checked. Updating the doc is part of "done" — never a follow-up.
