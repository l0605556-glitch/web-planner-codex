---
name: web-planner-codex
description: Coordinate complex, architectural, or multi-stage work between ChatGPT web and local Codex. Use when a task in the current Git repository needs an overall plan or rolling subtask plans from a persistent ChatGPT conversation, while Codex remains the only actor allowed to edit files, run commands, test, commit, or push. Do not use automatically for small, low-risk edits that Codex can complete directly.
---

# Web Planner for Codex

Use ChatGPT web as a read-only planning partner and Codex as the sole executor. Keep one ChatGPT conversation for one large goal. Use the public GitHub repository as the shared project snapshot; never grant ChatGPT local file, shell, Git write, or GitHub write access.

## Choose the path

- Handle a small, local, low-risk task directly in Codex unless the user explicitly asks for web planning.
- Use this workflow for architecture decisions, unclear requirements, cross-cutting changes, or work that naturally spans multiple stages.
- Tell the user when routing a task to ChatGPT. Honor a natural-language request to skip planning or force planning.

## Enforce the boundaries

- Work only in the current fixed workspace and verify its resolved path before acting.
- Treat existing changes and untracked files as user-owned. Do not include unrelated files in a stage, commit, or push.
- ChatGPT may read only the connected GitHub repository. It must not modify files, repositories, branches, pull requests, issues, settings, or secrets.
- Codex alone may edit local files and run commands or tests.
- Never upload secrets, credentials, personal data, private keys, environment files, or ignored files to a public repository.
- Never commit or push until the user explicitly accepts the stage report and authorizes publication. The phrase “确认并继续” counts only when it follows the report described below.
- Do not install software, create a remote repository, change repository visibility, or configure authentication without explicit authorization.

## Prepare the workflow

1. Resolve the workspace root and verify it contains `.git`.
2. Inspect `git status`, the current branch, and the configured remote without changing them.
3. Require a GitHub remote whose repository is public and readable by the user's connected ChatGPT account. If absent, private, or inaccessible, stop with one concrete action for the user.
4. Check that `.web-planner-codex/` is ignored. Store all transient plans and state there; never publish that directory.
5. Initialize state with `scripts/workflow-state.ps1 -Action init`. Record the goal, repository, and branch. Do not store tokens, cookies, file contents, or browser session data.
6. Use the in-app browser control skill to open ChatGPT. Reuse one planning conversation for the large goal and record its URL locally. If login or GitHub-source authorization requires user interaction, pause and ask for that single action.

Use `references/planning-prompts.md` for the exact planning contracts. Prefer a connected GitHub source over copying project files into the conversation. Always identify the repository, branch, and exact published revision so ChatGPT plans against real state.

## Get and approve the overall plan

1. Send the overall-planning contract once for a new large goal.
2. If it is uncertain whether the message was sent, inspect the conversation before resending. Avoid duplicate planning requests.
3. Save the response to `.web-planner-codex/overall-plan.md` and record it with `record-overall-plan`.
4. Reject the response as blocked if ChatGPT could not access the named repository/revision, invented files, proposed write actions for itself, or omitted a verifiable first subtask.
5. Present the understandable overall plan, task sequence, risks, success criteria, and first task plan to the user.
6. Do not execute the first task until the user explicitly approves the overall plan. Record approval with `approve-overall-plan`, then record the first plan with `record-task-plan`.

## Execute one subtask

1. Record `start-task` before editing.
2. Reinspect the files relevant to the approved subtask; ChatGPT's plan is advice, not authority over current local state.
3. Make the smallest change that satisfies the subtask. Do not expand scope silently.
4. Run focused validation proportional to the change.
5. If the plan conflicts with the repository, permissions, safety rules, or user requirements, stop and report the conflict. Do not guess through a material disagreement.
6. Save a concise report to `.web-planner-codex/stage-report.md` and record `stage-ready`.

## Use the stage gate

Show all of the following before asking for confirmation:

- What this subtask changed.
- What validation ran and its result.
- Every task-related file proposed for publication.
- Any unrelated working-tree changes that will be excluded.
- The sensitive-information scan result and any uncertainty.
- The next planned subtask, or that the goal is complete.

Ask the user to say “确认并继续” only if they accept the stage and authorize the listed files to be committed and pushed. Without that confirmation, do not publish and do not ask ChatGPT for the next plan.

After confirmation:

1. Record `approve-stage`.
2. Recheck the exact file list and sensitive-information scan.
3. Stage only the disclosed task-related files, commit, and push the current branch.
4. Record the published revision with `published`.
5. If work remains, send the next-task contract in the same ChatGPT conversation. Give the new revision and short completed-stage summary; do not resend whole files.
6. Save and record only the next subtask plan, then repeat the execution loop.
7. If no work remains, record `done` and report the final result.

## Recover safely

- Use `show` before continuing an existing workflow. Resume from recorded state instead of replaying completed actions.
- A browser timeout permits at most one safe retry after checking whether a response already exists.
- On logout, inaccessible GitHub content, ambiguous publication state, failed push, changed remote history, or a plan that no longer matches local files, record `block` and ask the user one decisive question.
- Never mark a stage published merely because a command was attempted. Verify the remote revision first.
- The first version has no post-execution ChatGPT code review. ChatGPT returns the overall plan and one next-subtask plan at a time.

## State command examples

Run the bundled script with PowerShell from the skill directory:

```powershell
.\scripts\workflow-state.ps1 -Action show -WorkspaceRoot "C:\path\to\project"
.\scripts\workflow-state.ps1 -Action init -WorkspaceRoot "C:\path\to\project" -Goal "Build the agreed feature" -Repository "owner/repo" -Branch "main"
```

Use `Get-Help .\scripts\workflow-state.ps1 -Detailed` for action-specific fields. The script tracks gates only; it never edits project files, invokes Git, accesses the network, or controls the browser.
