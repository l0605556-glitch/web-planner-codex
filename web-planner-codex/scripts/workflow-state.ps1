<#
.SYNOPSIS
Tracks the local gates for a ChatGPT-planned, Codex-executed workflow.

.DESCRIPTION
Writes only .web-planner-codex/state.json under the selected workspace. It does
not invoke Git, access the network, control a browser, or modify project files.

.PARAMETER Action
show, init, set-repository, set-conversation, record-overall-plan,
approve-overall-plan, record-task-plan, start-task, stage-ready,
approve-stage, published, block, pause, resume, or done.

.EXAMPLE
.\workflow-state.ps1 -Action init -WorkspaceRoot C:\src\app -Goal "Add export" -Repository owner/app -Branch main

.EXAMPLE
.\workflow-state.ps1 -Action record-task-plan -WorkspaceRoot C:\src\app -TaskId T1 -TaskTitle "Define export format" -PlanPath C:\src\app\.web-planner-codex\current-task-plan.md
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        'show',
        'init',
        'set-repository',
        'set-conversation',
        'record-overall-plan',
        'approve-overall-plan',
        'record-task-plan',
        'start-task',
        'stage-ready',
        'approve-stage',
        'published',
        'block',
        'pause',
        'resume',
        'done'
    )]
    [string]$Action,

    [string]$WorkspaceRoot = (Get-Location).Path,
    [string]$Goal,
    [string]$Repository,
    [string]$Branch,
    [string]$ConversationUrl,
    [string]$PlanPath,
    [string]$TaskId,
    [string]$TaskTitle,
    [string]$ReportPath,
    [string]$Revision,
    [string]$Reason,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Require-Value {
    param([string]$Value, [string]$Name)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "-$Name is required for action '$Action'."
    }
}

function Require-Status {
    param($State, [string[]]$Allowed)
    if ($Allowed -notcontains $State.status) {
        throw "Action '$Action' is not valid while status is '$($State.status)'. Expected: $($Allowed -join ', ')."
    }
}

function Resolve-PrivateWorkflowFile {
    param([string]$PathValue, [string]$ParameterName)
    Require-Value $PathValue $ParameterName
    $resolvedFile = (Resolve-Path -LiteralPath $PathValue).Path
    $privatePrefix = $stateDirectory.TrimEnd('\') + '\'
    if (-not $resolvedFile.StartsWith($privatePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "-$ParameterName must point to a file inside the private .web-planner-codex directory."
    }
    return $resolvedFile
}

function Read-State {
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
        throw "No workflow state exists at '$statePath'. Run -Action init first."
    }
    return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
}

function Set-Property {
    param($Object, [string]$Name, $Value)
    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Save-State {
    param($State)
    Set-Property $State 'updatedAt' ([DateTimeOffset]::Now.ToString('o'))
    if (-not (Test-Path -LiteralPath $stateDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $stateDirectory | Out-Null
    }
    $temporaryPath = Join-Path $stateDirectory ("state.$([Guid]::NewGuid().ToString('N')).tmp")
    $json = $State | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($temporaryPath, $json, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporaryPath -Destination $statePath -Force
}

$resolvedWorkspace = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
$stateDirectory = Join-Path $resolvedWorkspace '.web-planner-codex'
$statePath = Join-Path $stateDirectory 'state.json'

if ($Action -eq 'init') {
    Require-Value $Goal 'Goal'
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedWorkspace '.git'))) {
        throw "Workspace '$resolvedWorkspace' is not a Git repository."
    }
    if ((Test-Path -LiteralPath $statePath) -and -not $Force) {
        throw "Workflow state already exists. Use -Action show, or use -Force only when intentionally replacing local workflow state."
    }

    $now = [DateTimeOffset]::Now.ToString('o')
    $state = [PSCustomObject]@{
        schemaVersion          = 1
        workflowId            = [Guid]::NewGuid().ToString()
        workspaceRoot         = $resolvedWorkspace
        repository            = $Repository
        branch                = $Branch
        goal                  = $Goal
        conversationUrl       = $null
        status                = 'awaiting_overall_plan'
        resumeStatus          = $null
        blockedReason         = $null
        overallPlanPath       = $null
        currentTask           = $null
        completedTasks        = @()
        pendingReportPath     = $null
        lastPublishedRevision = $null
        createdAt             = $now
        updatedAt             = $now
    }
    Save-State $state
    $state | ConvertTo-Json -Depth 12
    exit 0
}

$state = Read-State

switch ($Action) {
    'show' {
        $state | ConvertTo-Json -Depth 12
        exit 0
    }

    'set-repository' {
        Require-Value $Repository 'Repository'
        if ($Repository -notmatch '^[^/\s]+/[^/\s]+$') {
            throw "-Repository must use the form owner/repository."
        }
        Set-Property $state 'repository' $Repository
        if (-not [string]::IsNullOrWhiteSpace($Branch)) {
            Set-Property $state 'branch' $Branch
        }
    }

    'set-conversation' {
        Require-Value $ConversationUrl 'ConversationUrl'
        if ($ConversationUrl -notmatch '^https://chatgpt\.com/') {
            throw "-ConversationUrl must be a chatgpt.com URL."
        }
        Set-Property $state 'conversationUrl' $ConversationUrl
    }

    'record-overall-plan' {
        Require-Status $state @('awaiting_overall_plan')
        $resolvedPlan = Resolve-PrivateWorkflowFile $PlanPath 'PlanPath'
        Set-Property $state 'overallPlanPath' $resolvedPlan
        Set-Property $state 'status' 'awaiting_plan_approval'
    }

    'approve-overall-plan' {
        Require-Status $state @('awaiting_plan_approval')
        Set-Property $state 'status' 'ready_for_task_plan'
    }

    'record-task-plan' {
        Require-Status $state @('ready_for_task_plan', 'awaiting_next_plan')
        Require-Value $TaskId 'TaskId'
        Require-Value $TaskTitle 'TaskTitle'
        $resolvedPlan = Resolve-PrivateWorkflowFile $PlanPath 'PlanPath'
        $task = [PSCustomObject]@{
            id        = $TaskId
            title     = $TaskTitle
            planPath  = $resolvedPlan
            startedAt = $null
        }
        Set-Property $state 'currentTask' $task
        Set-Property $state 'status' 'ready_to_execute'
    }

    'start-task' {
        Require-Status $state @('ready_to_execute')
        Set-Property $state.currentTask 'startedAt' ([DateTimeOffset]::Now.ToString('o'))
        Set-Property $state 'status' 'executing_task'
    }

    'stage-ready' {
        Require-Status $state @('executing_task')
        $resolvedReport = Resolve-PrivateWorkflowFile $ReportPath 'ReportPath'
        Set-Property $state 'pendingReportPath' $resolvedReport
        Set-Property $state 'status' 'awaiting_stage_approval'
    }

    'approve-stage' {
        Require-Status $state @('awaiting_stage_approval')
        Set-Property $state 'status' 'approved_to_publish'
    }

    'published' {
        Require-Status $state @('approved_to_publish')
        Require-Value $Revision 'Revision'
        if ($Revision -notmatch '^[0-9a-fA-F]{7,64}$') {
            throw "-Revision must look like a Git commit SHA."
        }
        $completed = @($state.completedTasks)
        $completed += [PSCustomObject]@{
            id          = $state.currentTask.id
            title       = $state.currentTask.title
            revision    = $Revision
            completedAt = [DateTimeOffset]::Now.ToString('o')
        }
        Set-Property $state 'completedTasks' $completed
        Set-Property $state 'lastPublishedRevision' $Revision
        Set-Property $state 'currentTask' $null
        Set-Property $state 'pendingReportPath' $null
        Set-Property $state 'status' 'awaiting_next_plan'
    }

    'block' {
        Require-Value $Reason 'Reason'
        if ($state.status -ne 'blocked') {
            Set-Property $state 'resumeStatus' $state.status
        }
        Set-Property $state 'blockedReason' $Reason
        Set-Property $state 'status' 'blocked'
    }

    'pause' {
        if ($state.status -eq 'paused') {
            throw "Workflow is already paused."
        }
        Set-Property $state 'resumeStatus' $state.status
        Set-Property $state 'status' 'paused'
    }

    'resume' {
        Require-Status $state @('paused', 'blocked')
        if ([string]::IsNullOrWhiteSpace($state.resumeStatus)) {
            throw "No prior status is available to resume."
        }
        Set-Property $state 'status' $state.resumeStatus
        Set-Property $state 'resumeStatus' $null
        Set-Property $state 'blockedReason' $null
    }

    'done' {
        Require-Status $state @('awaiting_next_plan', 'ready_for_task_plan')
        Set-Property $state 'status' 'done'
    }
}

Save-State $state
$state | ConvertTo-Json -Depth 12
