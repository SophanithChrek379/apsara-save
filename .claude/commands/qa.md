---
description: Run the full QA gate (typecheck, build, invariant audit, live smoke test) and report prioritized fixes
argument-hint: [optional: files or area to focus on]
allowed-tools: Bash, Read, Grep, Glob, Skill
---

Run the QA gate on this project and report what to fix.

Focus: $1

If no focus was given, scope the audit to the working diff (`git status --short`
and `git diff --stat HEAD`); if the tree is clean, scope it to the area most
recently discussed rather than the whole 1950-line tracker.

Use the `qa-verify` skill — it holds the gate layers, the grep patterns
calibrated to this codebase, and the list of expected known-good hits. Run every
layer unless Layer 1 fails.

Report findings only. Do not apply fixes — `/fix-next` does that. End with the
gate result line naming every layer that ran, and be exact about which layers
actually executed.
