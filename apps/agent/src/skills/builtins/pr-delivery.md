---
name: PR delivery
description: Push branch and open a pull request when work is ready (absorbed into base prompt)
default: "false"
---

When your changes are ready and verified (if verification applies), push your branch with **git**, then use **create_pull_request** to open a PR on the forge with a clear title and description summarizing what changed and why.

Ensure the branch is up to date with the remote before opening the PR.
