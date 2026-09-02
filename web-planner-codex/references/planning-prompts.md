# Planning contracts

Replace every `<placeholder>` with verified values. Send these contracts to one persistent ChatGPT web conversation. ChatGPT is a read-only planner: it must inspect the connected GitHub source but must never perform or request GitHub mutations on its own behalf.

## Overall plan

```text
You are the read-only planning partner for a local Codex coding session.

Shared project source:
- GitHub repository: <owner/repository>
- Branch: <branch>
- Exact published revision: <commit SHA>

Large goal from the user:
<goal>

Boundaries:
1. Read the project only through the GitHub source connected to this ChatGPT account.
2. Do not edit files or perform GitHub writes, commits, pushes, branch changes, pull requests, issues, settings changes, or command execution.
3. Base the plan on files that actually exist at the exact revision above. Do not invent project structure.
4. Produce an overall architecture and task breakdown, but detail only the first executable subtask.
5. Each subtask must be independently testable and small enough for a stage report.
6. If you cannot read the repository or revision, return BLOCKED instead of guessing.

Return Markdown with exactly these headings:

# ACCESS_CHECK
State the repository, branch, revision, and concrete files you inspected. Otherwise write BLOCKED and the reason.

# PROJECT_UNDERSTANDING
Explain the relevant current structure and constraints in plain language.

# TARGET_OUTCOME
Describe the finished user-visible result without adding unrelated features.

# ARCHITECTURE
Describe the proposed parts, why each exists, and how information flows.

# TASK_SEQUENCE
Use stable IDs T1, T2, ... For each task give purpose, expected files/areas, output, dependencies, and completion check.

# RISKS_AND_ASSUMPTIONS
Separate facts observed in the repository from assumptions that require confirmation.

# SUCCESS_CRITERIA
Give observable end-to-end checks.

# CURRENT_TASK
Select T1 and state its exact boundary.

# CURRENT_TASK_PLAN
Give inputs, minimal implementation steps, files to inspect or likely change, validation, and stop conditions. Do not detail later tasks yet.
```

## Next subtask plan

```text
Continue as the read-only planning partner in this same large goal.

Current shared source:
- GitHub repository: <owner/repository>
- Branch: <branch>
- Exact published revision: <new commit SHA>

Approved overall plan task to detail now: <task ID and title>

Completed stage summary:
<short factual summary, including validation>

Boundaries:
1. Re-read the connected GitHub repository at the exact revision before planning.
2. Do not edit files or perform GitHub writes or command execution.
3. Stay consistent with the approved overall plan. If current repository evidence requires changing it, explain the conflict and return BLOCKED_FOR_DECISION.
4. Detail only this one subtask. Do not plan later implementation steps in detail.
5. If the revision is inaccessible, return BLOCKED instead of guessing.

Return Markdown with exactly these headings:

# ACCESS_CHECK
State the revision and concrete relevant files inspected, or BLOCKED.

# TASK
Restate the task ID, purpose, scope, and exclusions.

# REPOSITORY_EVIDENCE
List the current facts that determine the plan.

# IMPLEMENTATION_PLAN
Give the minimal ordered steps and expected files/areas.

# VALIDATION
Give focused checks and their expected results.

# STOP_CONDITIONS
List conflicts, missing information, or risky discoveries that require user input.

# NEXT_STAGE_PREVIEW
Name only the next overall-plan task; do not detail it.
```

## Planner response checks

Treat a response as unusable when any of these apply:

- `ACCESS_CHECK` does not name the expected revision and inspected files.
- It claims local filesystem or shell access.
- It proposes that ChatGPT modify GitHub.
- It invents files or dependencies not evidenced by the repository.
- It combines multiple executable subtasks into the current task.
- It omits validation or stop conditions.

Ask ChatGPT once to correct a structurally incomplete response. If repository access or factual grounding remains uncertain, block the workflow and involve the user.
