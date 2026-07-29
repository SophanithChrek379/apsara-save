---
description: Run the QA gate, apply the highest-value fixes it finds, then re-verify that they hold
argument-hint: [optional: severity floor, e.g. blockers | should-fix | all]
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Skill
---

Run the QA gate, fix what it finds, and prove the fixes hold.

Severity floor: $1 (default: blockers and should-fix; leave improvements as
suggestions unless told otherwise)

1. **Gate.** Run the `qa-verify` skill in full.
2. **Triage.** List what you intend to fix and what you are deliberately
   leaving, with a reason for each exclusion. Do not silently narrow scope.
3. **Fix.** Work through them in severity order, smallest safe change each time.
   Follow `CLAUDE.md` and the `ui-component` skill — match the surrounding
   comment style, keep dark-mode parity, keep clock and storage reads behind the
   `mounted` gate.
4. **Re-verify.** Re-run the gate. A fix is not done because it was written; it
   is done when typecheck, build, and the live smoke check pass with it in place.
   If a fix broke something else, say so and resolve it.
5. **Report.** What changed and why, what you left and why, and the final gate
   line.

If the gate comes back clean, say so and stop. Do not invent work to justify the
run. If a finding turns out to be wrong on closer reading, drop it and say why
rather than changing correct code to satisfy a bad check.
