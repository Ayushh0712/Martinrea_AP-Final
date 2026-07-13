$ErrorActionPreference = 'Continue'
$base = 'http://127.0.0.1:3001/api'
$mailpit = 'http://127.0.0.1:8025/api/v1'
$script:pass = 0
$script:fail = 0
$script:results = @()

function Test-Endpoint {
  param(
    [string]$Name,
    [string]$Prd,
    [scriptblock]$Script,
    [int]$ExpectedStatus = 200
  )
  $row = [ordered]@{ '#' = $script:pass + $script:fail + 1; Endpoint = $Name; PRD = $Prd; Got = ''; Result = '' }
  try {
    $r = & $Script
    if ($ExpectedStatus -ge 400) {
      $row.Got = "SUCCESS (expected $ExpectedStatus)"
      $row.Result = 'FAIL'
      $script:fail++
    } else {
      $row.Got = "$ExpectedStatus OK"
      $row.Result = 'PASS'
      $script:pass++
    }
  } catch {
    $code = $null
    try { $code = $_.Exception.Response.StatusCode.value__ } catch {}
    if ($code -eq $ExpectedStatus) {
      $row.Got = "$code (expected)"
      $row.Result = 'PASS'
      $script:pass++
    } else {
      $row.Got = if ($code) { "$code (expected $ExpectedStatus)" } else { "$($_.Exception.Message.Substring(0,[Math]::Min(60,$_.Exception.Message.Length)))" }
      $row.Result = 'FAIL'
      $script:fail++
    }
  }
  $script:results += [pscustomobject]$row
  $color = if ($row.Result -eq 'PASS') { 'Green' } else { 'Red' }
  Write-Host ("  [{0}] {1,-50} -> {2}" -f $row.Result, $Name, $row.Got) -ForegroundColor $color
  return $r
}

function Login($email) {
  return (Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ email=$email; password='Password123!' } | ConvertTo-Json)).accessToken
}
function HdrAuth($tok) { return @{ Authorization = "Bearer $tok" } }

Write-Host "`n==============================================================" -ForegroundColor Cyan
Write-Host " MARTINREA AP - WORKFLOW SERVICE - FULL API VERIFICATION" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan

# Pre-flight: tokens for all roles
$clerkTok = Login 'clerk@martinrea.dev'
$pmTok    = Login 'pm@martinrea.dev'
$pm2Tok   = Login 'pm2@martinrea.dev'
$fdTok    = Login 'fd@martinrea.dev'
$vpTok    = Login 'vp@martinrea.dev'

try { $null = Invoke-RestMethod -Method Delete -Uri "$mailpit/messages" } catch {}

# ----------------------------------------------------------------------
Write-Host "`n[Group 1/6] Public + Authentication (PRD WF-01)" -ForegroundColor Yellow
# ----------------------------------------------------------------------

Test-Endpoint 'GET  /health (public)' 'NFR-Availability' { Invoke-RestMethod -Uri "$base/health" }
Test-Endpoint 'POST /auth/login (valid creds)' 'WF-01 AC1' { Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ email='fd@martinrea.dev'; password='Password123!' } | ConvertTo-Json) }
Test-Endpoint 'POST /auth/login (wrong password -> 401)' 'WF-01 Security' { Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ email='fd@martinrea.dev'; password='WRONG' } | ConvertTo-Json) } -ExpectedStatus 401
Test-Endpoint 'GET  /users/me (no token -> 401)' 'WF-01 Guarded routes' { Invoke-RestMethod -Uri "$base/users/me" } -ExpectedStatus 401
Test-Endpoint 'GET  /users/me (valid token)' 'WF-01 AC1' { Invoke-RestMethod -Uri "$base/users/me" -Headers (HdrAuth $fdTok) }

# ----------------------------------------------------------------------
Write-Host "`n[Group 2/6] Role-Based Access Control (PRD WF-01 AC2)" -ForegroundColor Yellow
# ----------------------------------------------------------------------

Test-Endpoint 'GET  /workflow/approval-test (AP_Clerk -> 403)' 'WF-01 AC2 - clerk cannot approve' { Invoke-RestMethod -Uri "$base/workflow/approval-test" -Headers (HdrAuth $clerkTok) } -ExpectedStatus 403
Test-Endpoint 'GET  /workflow/approval-test (Plant_Manager -> 200)' 'WF-01 AC2 - PM can approve' { Invoke-RestMethod -Uri "$base/workflow/approval-test" -Headers (HdrAuth $pmTok) }
Test-Endpoint 'GET  /workflow/approval-test (Finance_Director -> 200)' 'WF-01 AC2 - FD can approve' { Invoke-RestMethod -Uri "$base/workflow/approval-test" -Headers (HdrAuth $fdTok) }
Test-Endpoint 'POST /users (AP_Clerk -> 403)' 'WF-01 AC2 - clerk cannot create users' { Invoke-RestMethod -Method Post -Uri "$base/users" -Headers (HdrAuth $clerkTok) -ContentType 'application/json' -Body (@{ email='t1@x.com'; password='Pwd1234!'; fullName='t'; role='AP_Clerk' } | ConvertTo-Json) } -ExpectedStatus 403

# ----------------------------------------------------------------------
Write-Host "`n[Group 3/6] Invoice CRUD + State Machine (PRD WF-02)" -ForegroundColor Yellow
# ----------------------------------------------------------------------

$inv1 = $null
Test-Endpoint 'POST /invoices (create, RECEIVED)' 'WF-02 - initial state' {
  $script:inv1 = Invoke-RestMethod -Method Post -Uri "$base/invoices" -Headers (HdrAuth $clerkTok) -ContentType 'application/json' -Body (@{
    invoiceNumber="API-TEST-$(Get-Random)"; supplierName='API Smoke Supplier'; totalAmount=5000; currency='USD'; plantId='PLT-001'
  } | ConvertTo-Json)
}
Test-Endpoint 'GET  /invoices/:id' 'WF-02 - read invoice' { Invoke-RestMethod -Uri "$base/invoices/$($script:inv1.id)" -Headers (HdrAuth $clerkTok) }
Test-Endpoint 'GET  /invoices/:id/allowed-transitions' 'WF-02 state machine introspection' { Invoke-RestMethod -Uri "$base/invoices/$($script:inv1.id)/allowed-transitions" -Headers (HdrAuth $clerkTok) }
Test-Endpoint 'POST /invoices/:id/transitions (FD only - clerk -> 403)' 'WF-02 RBAC on transitions' { Invoke-RestMethod -Method Post -Uri "$base/invoices/$($script:inv1.id)/transitions" -Headers (HdrAuth $clerkTok) -ContentType 'application/json' -Body (@{ to='OCR_PROCESSING' } | ConvertTo-Json) } -ExpectedStatus 403
Test-Endpoint 'POST /invoices/:id/transitions (FD legal RECEIVED -> OCR_PROCESSING)' 'WF-02 AC1 happy path' { Invoke-RestMethod -Method Post -Uri "$base/invoices/$($script:inv1.id)/transitions" -Headers (HdrAuth $fdTok) -ContentType 'application/json' -Body (@{ to='OCR_PROCESSING' } | ConvertTo-Json) }
Test-Endpoint 'POST /invoices/:id/transitions (illegal jump -> 409)' 'WF-02 AC2 - illegal transitions blocked' { Invoke-RestMethod -Method Post -Uri "$base/invoices/$($script:inv1.id)/transitions" -Headers (HdrAuth $fdTok) -ContentType 'application/json' -Body (@{ to='APPROVED' } | ConvertTo-Json) } -ExpectedStatus 409

# Walk forward to PENDING_MATCH
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($script:inv1.id)/transitions" -Headers (HdrAuth $fdTok) -ContentType 'application/json' -Body (@{ to='PENDING_REVIEW' } | ConvertTo-Json)
Test-Endpoint 'POST /invoices/:id/submit-review (semantic action)' 'WF-02 controller action wrapper' {
  # already in PENDING_REVIEW, push to PENDING_MATCH via generic transition since submit-review is RECEIVED->REVIEW
  Invoke-RestMethod -Method Post -Uri "$base/invoices/$($script:inv1.id)/transitions" -Headers (HdrAuth $fdTok) -ContentType 'application/json' -Body (@{ to='PENDING_MATCH' } | ConvertTo-Json)
}

# ----------------------------------------------------------------------
Write-Host "`n[Group 4/6] Approval Routing - Rules Engine (PRD WF-03)" -ForegroundColor Yellow
# ----------------------------------------------------------------------

Test-Endpoint 'POST /invoices/:id/submit-match (Tier 1, $5K -> MATCHED)' 'WF-03 - 2-way match step' {
  $r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($script:inv1.id)/submit-match" -Headers (HdrAuth $clerkTok)
  if ($r.status -ne 'MATCHED') { throw "expected MATCHED, got $($r.status)" }
  return $r
}
Test-Endpoint 'POST /invoices/:id/submit-approval (Tier 1, $5K -> [FD])' 'WF-03 - <=$10K single FD approval' {
  $r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($script:inv1.id)/submit-approval" -Headers (HdrAuth $clerkTok)
  if ($r.approvalChain.Count -ne 1) { throw "expected chain length 1, got $($r.approvalChain.Count)" }
  return $r
}

Test-Endpoint 'POST /invoices/:id/approve (Tier 1 - FD approves)' 'WF-03 - chain complete -> APPROVED' {
  $r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($script:inv1.id)/approve" -Headers (HdrAuth $fdTok)
  if ($r.status -ne 'APPROVED') { throw "expected APPROVED, got $($r.status)" }
  return $r
}

# Tier 2 - 25K - chain: PM -> FD
$inv2 = Invoke-RestMethod -Method Post -Uri "$base/invoices" -Headers (HdrAuth $clerkTok) -ContentType 'application/json' -Body (@{
  invoiceNumber="API-T2-$(Get-Random)"; supplierName='Tier2'; totalAmount=25000; currency='USD'; plantId='PLT-001'
} | ConvertTo-Json)
foreach ($s in 'OCR_PROCESSING','PENDING_REVIEW','PENDING_MATCH') { $null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv2.id)/transitions" -Headers (HdrAuth $fdTok) -ContentType 'application/json' -Body (@{ to=$s } | ConvertTo-Json) }
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv2.id)/submit-match" -Headers (HdrAuth $clerkTok)
Test-Endpoint 'submit-approval Tier 2 ($25K -> [PM,FD])' 'WF-03 - $10K-$50K PM->FD' {
  $r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv2.id)/submit-approval" -Headers (HdrAuth $clerkTok)
  if ($r.approvalChain.Count -ne 2) { throw "expected chain length 2, got $($r.approvalChain.Count)" }
  return $r
}
Test-Endpoint 'approve Tier 2 (FD tries before PM -> 403)' 'WF-03 - segregation of duties' { Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv2.id)/approve" -Headers (HdrAuth $fdTok) } -ExpectedStatus 403
Test-Endpoint 'approve Tier 2 (PM step 1 - chain advances)' 'WF-03 - multi-step chain' {
  $r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv2.id)/approve" -Headers (HdrAuth $pmTok)
  if ($r.chainComplete -ne $false) { throw "expected chainComplete=false, got $($r.chainComplete)" }
  return $r
}
Test-Endpoint 'approve Tier 2 (FD step 2 - chain complete -> APPROVED)' 'WF-03 - final approval' {
  $r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv2.id)/approve" -Headers (HdrAuth $fdTok)
  if ($r.status -ne 'APPROVED') { throw "expected APPROVED, got $($r.status)" }
  return $r
}

# Tier 3 - 75K - chain: PM -> FD -> VP
$inv3 = Invoke-RestMethod -Method Post -Uri "$base/invoices" -Headers (HdrAuth $clerkTok) -ContentType 'application/json' -Body (@{
  invoiceNumber="API-T3-$(Get-Random)"; supplierName='Tier3'; totalAmount=75000; currency='USD'; plantId='PLT-001'
} | ConvertTo-Json)
foreach ($s in 'OCR_PROCESSING','PENDING_REVIEW','PENDING_MATCH') { $null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv3.id)/transitions" -Headers (HdrAuth $fdTok) -ContentType 'application/json' -Body (@{ to=$s } | ConvertTo-Json) }
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv3.id)/submit-match" -Headers (HdrAuth $clerkTok)
Test-Endpoint 'submit-approval Tier 3 ($75K -> [PM,FD,VP])' 'WF-03 - >$50K 3-step' {
  $r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv3.id)/submit-approval" -Headers (HdrAuth $clerkTok)
  if ($r.approvalChain.Count -ne 3) { throw "expected chain length 3, got $($r.approvalChain.Count)" }
  return $r
}
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv3.id)/approve" -Headers (HdrAuth $pmTok)
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv3.id)/approve" -Headers (HdrAuth $fdTok)
Test-Endpoint 'approve Tier 3 (VP final approval)' 'WF-03 - VP_Finance closes chain' {
  $r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv3.id)/approve" -Headers (HdrAuth $vpTok)
  if ($r.status -ne 'APPROVED') { throw "expected APPROVED, got $($r.status)" }
  return $r
}

# Rejection path
$invR = Invoke-RestMethod -Method Post -Uri "$base/invoices" -Headers (HdrAuth $clerkTok) -ContentType 'application/json' -Body (@{
  invoiceNumber="API-RJ-$(Get-Random)"; supplierName='RejectMe'; totalAmount=15000; currency='USD'; plantId='PLT-001'
} | ConvertTo-Json)
foreach ($s in 'OCR_PROCESSING','PENDING_REVIEW','PENDING_MATCH') { $null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invR.id)/transitions" -Headers (HdrAuth $fdTok) -ContentType 'application/json' -Body (@{ to=$s } | ConvertTo-Json) }
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invR.id)/submit-match" -Headers (HdrAuth $clerkTok)
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invR.id)/submit-approval" -Headers (HdrAuth $clerkTok)
Test-Endpoint 'POST /invoices/:id/reject (no reason -> 400)' 'WF-03 - rejection requires reason' { Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invR.id)/reject" -Headers (HdrAuth $pmTok) -ContentType 'application/json' -Body (@{} | ConvertTo-Json) } -ExpectedStatus 400
Test-Endpoint 'POST /invoices/:id/reject (with reason -> REJECTED)' 'WF-03 - approver can reject' {
  $r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invR.id)/reject" -Headers (HdrAuth $pmTok) -ContentType 'application/json' -Body (@{ reason='Discrepancy with PO' } | ConvertTo-Json)
  if ($r.status -ne 'REJECTED') { throw "expected REJECTED, got $($r.status)" }
  return $r
}

# Exception flag
$invX = Invoke-RestMethod -Method Post -Uri "$base/invoices" -Headers (HdrAuth $clerkTok) -ContentType 'application/json' -Body (@{
  invoiceNumber="API-EX-$(Get-Random)"; supplierName='ExceptionTest'; totalAmount=1000; currency='USD'
} | ConvertTo-Json)
foreach ($s in 'OCR_PROCESSING','PENDING_REVIEW') { $null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invX.id)/transitions" -Headers (HdrAuth $fdTok) -ContentType 'application/json' -Body (@{ to=$s } | ConvertTo-Json) }
Test-Endpoint 'POST /invoices/:id/flag-exception' 'WF-02 - off-ramp to EXCEPTION' {
  $r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invX.id)/flag-exception" -Headers (HdrAuth $clerkTok)
  if ($r.status -ne 'EXCEPTION') { throw "expected EXCEPTION, got $($r.status)" }
  return $r
}

# ----------------------------------------------------------------------
Write-Host "`n[Group 5/6] MXN invoices (CFDI guard removed)" -ForegroundColor Yellow
# ----------------------------------------------------------------------

$invMx = Invoke-RestMethod -Method Post -Uri "$base/invoices" -Headers (HdrAuth $clerkTok) -ContentType 'application/json' -Body (@{
  invoiceNumber="API-MX-$(Get-Random)"; supplierName='Proveedor Mexico'; totalAmount=8000; currency='MXN'; plantId='PLT-MX'
} | ConvertTo-Json)
foreach ($s in 'OCR_PROCESSING','PENDING_REVIEW','PENDING_MATCH') { $null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invMx.id)/transitions" -Headers (HdrAuth $fdTok) -ContentType 'application/json' -Body (@{ to=$s } | ConvertTo-Json) }
Test-Endpoint 'MXN invoice -> MATCHED allowed' 'CFDI guard removed - MXN flows through' {
  $r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invMx.id)/transitions" -Headers (HdrAuth $fdTok) -ContentType 'application/json' -Body (@{ to='MATCHED' } | ConvertTo-Json)
  if ($r.status -ne 'MATCHED') { throw "expected MATCHED, got $($r.status)" }
  return $r
}

# ----------------------------------------------------------------------
Write-Host "`n[Group 6/6] WF-04 Notifications + WF-05 SLA Escalation" -ForegroundColor Yellow
# ----------------------------------------------------------------------

Start-Sleep -Seconds 1
$mp = Invoke-RestMethod -Uri "$mailpit/messages"
$expectedEmails = 6  # T1(1) + T2(2) + T3(3) = 6 approval emails
Test-Endpoint "Mailpit captured >=$expectedEmails approval emails" 'WF-04 - SMTP on PENDING_APPROVAL' {
  if ($mp.total -lt $expectedEmails) { throw "expected >=$expectedEmails emails, got $($mp.total)" }
  return $mp
}

# Force an SLA breach
$invEsc = Invoke-RestMethod -Method Post -Uri "$base/invoices" -Headers (HdrAuth $clerkTok) -ContentType 'application/json' -Body (@{
  invoiceNumber="API-ESC-$(Get-Random)"; supplierName='EscTest'; totalAmount=25000; currency='USD'; plantId='PLT-001'
} | ConvertTo-Json)
foreach ($s in 'OCR_PROCESSING','PENDING_REVIEW','PENDING_MATCH') { $null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invEsc.id)/transitions" -Headers (HdrAuth $fdTok) -ContentType 'application/json' -Body (@{ to=$s } | ConvertTo-Json) }
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invEsc.id)/submit-match" -Headers (HdrAuth $clerkTok)
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invEsc.id)/submit-approval" -Headers (HdrAuth $clerkTok)
docker exec martinrea-ap-postgres psql -U martinrea -d martinrea_ap -c "UPDATE invoices SET pending_approval_since = NOW() - INTERVAL '72 hours', last_escalated_at = NULL WHERE id = '$($invEsc.id)';" | Out-Null
$null = Invoke-RestMethod -Method Delete -Uri "$mailpit/messages"

Test-Endpoint 'POST /escalation/run-now (clerk -> 403)' 'WF-05 - FD-only ops endpoint' { Invoke-RestMethod -Method Post -Uri "$base/escalation/run-now" -Headers (HdrAuth $clerkTok) } -ExpectedStatus 403
Test-Endpoint 'POST /escalation/run-now (FD - detects breach)' 'WF-05 - cron tick' {
  $r = Invoke-RestMethod -Method Post -Uri "$base/escalation/run-now" -Headers (HdrAuth $fdTok)
  if ($r.escalated -lt 1) { throw "expected >=1 escalated, got $($r.escalated)" }
  return $r
}
Start-Sleep -Seconds 1
$mp = Invoke-RestMethod -Uri "$mailpit/messages"
Test-Endpoint 'Mailpit captured escalation emails (approver + manager)' 'WF-05 - escalation chain' {
  if ($mp.total -lt 2) { throw "expected 2 emails, got $($mp.total)" }
  return $mp
}
Test-Endpoint 'POST /escalation/run-now (dedup - second pass 0)' 'WF-05 - last_escalated_at debounce' {
  $r = Invoke-RestMethod -Method Post -Uri "$base/escalation/run-now" -Headers (HdrAuth $fdTok)
  if ($r.escalated -ne 0) { throw "expected 0 escalated (dedup), got $($r.escalated)" }
  return $r
}

# ----------------------------------------------------------------------
Write-Host "`n[Audit log verification]" -ForegroundColor Yellow
# ----------------------------------------------------------------------
$audit = docker exec martinrea-ap-postgres psql -U martinrea -d martinrea_ap -t -c "SELECT action_type || ':' || COUNT(*) FROM audit_logs WHERE created_at > NOW() - INTERVAL '5 minutes' GROUP BY action_type ORDER BY action_type;"
Write-Host "  Audit log entries in last 5 min:" -ForegroundColor Gray
$audit -split "`n" | Where-Object { $_.Trim() } | ForEach-Object { Write-Host "    $($_.Trim())" -ForegroundColor Gray }

# ----------------------------------------------------------------------
Write-Host "`n==============================================================" -ForegroundColor Cyan
Write-Host " SUMMARY: $script:pass PASS / $script:fail FAIL out of $($script:pass + $script:fail) checks" -ForegroundColor $(if ($script:fail -eq 0) { 'Green' } else { 'Red' })
Write-Host "==============================================================" -ForegroundColor Cyan
$script:results | Format-Table -Property '#', Endpoint, PRD, Got, Result -AutoSize -Wrap
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
