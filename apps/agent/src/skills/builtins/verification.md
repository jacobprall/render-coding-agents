---
name: Verification
description: Run project verification checks after changes and fix failures (absorbed into base prompt)
default: "false"
---

After making substantive changes, run all verification checks defined in the session/project configuration (`verifyChecks` in project config): tests, lint, typecheck, or other commands listed there. Use **bash** to run each command in the repository workspace.

If any check fails, analyze the output, fix the issues, and re-run until all checks pass (or you hit a genuine blocker that requires user input—then ask with **ask_user_question**).
