$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3001/api'
$mailpit = 'http://localhost:8025/api/v1'

function Login($email, $password) {
  $body = @{ email = $email; password = $password } | ConvertTo-Json
  return (Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $body).accessToken
}
function AuthHdr($tok) { return @{ Authorization = "Bearer $tok" } }
function Json($obj) { return ($obj | ConvertTo-Json -Compress -Depth 10) }
function Expect-Status($expected, $script) {
  try { $r = & $script; Write-Host "  unexpected success (expected $expected): $(Json $r)" -ForegroundColor Red }
  catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq $expected) { Write-Host "  OK $code" -ForegroundColor Green }
    else { Write-Host "  WRONG STATUS expected=$expected got=$code" -ForegroundColor Red }
  }
}
function Walk($id, $tok, $statuses) {
  foreach ($s in $statuses) {
    $null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$id/transitions" -Headers (AuthHdr $tok) -ContentType 'application/json' -Body (@{ to=$s } | ConvertTo-Json)
  }
}

$clerk = Login 'clerk@martinrea.dev' 'Password123!'
$pm    = Login 'pm@martinrea.dev'    'Password123!'
$fd    = Login 'fd@martinrea.dev'    'Password123!'
$vp    = Login 'vp@martinrea.dev'    'Password123!'

# Empty Mailpit so we can count fresh emails
try { $null = Invoke-RestMethod -Method Delete -Uri "$mailpit/messages" } catch {}

Write-Host "`n=== WF-03 T1: Tier 1 (<=$10K) routes directly to FD ===" -ForegroundColor Cyan
$inv = Invoke-RestMethod -Method Post -Uri "$base/invoices" -Headers (AuthHdr $clerk) -ContentType 'application/json' -Body (@{
  invoiceNumber='WF03-T1'; supplierName='Tier1 Supplier'; totalAmount=5000; currency='USD'; plantId='PLT-001'
} | ConvertTo-Json)
Walk $inv.id $fd @('OCR_PROCESSING','PENDING_REVIEW','PENDING_MATCH')
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv.id)/submit-match" -Headers (AuthHdr $clerk)
$r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv.id)/submit-approval" -Headers (AuthHdr $clerk)
Write-Host "  Status=$($r.status), chain length=$($r.approvalChain.Count), currentApproverId=$($r.currentApproverId)" -ForegroundColor Yellow
if ($r.approvalChain.Count -eq 1) { Write-Host "  OK - single approver" -ForegroundColor Green } else { Write-Host "  FAIL - expected 1 approver" -ForegroundColor Red }

Write-Host "`n=== WF-03 T2: PM cannot approve a Tier 1 invoice (only FD is in chain) ===" -ForegroundColor Cyan
Expect-Status 403 { Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv.id)/approve" -Headers (AuthHdr $pm) }

Write-Host "`n=== WF-03 T3: FD approves Tier 1 -> chainComplete, status=APPROVED ===" -ForegroundColor Cyan
$r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv.id)/approve" -Headers (AuthHdr $fd)
Write-Host "  Status=$($r.status), chainComplete=$($r.chainComplete)" -ForegroundColor Green

Write-Host "`n=== WF-03 T4: Tier 2 ($25K) routes PM -> FD ===" -ForegroundColor Cyan
$inv2 = Invoke-RestMethod -Method Post -Uri "$base/invoices" -Headers (AuthHdr $clerk) -ContentType 'application/json' -Body (@{
  invoiceNumber='WF03-T2'; supplierName='Tier2 Supplier'; totalAmount=25000; currency='USD'; plantId='PLT-001'
} | ConvertTo-Json)
Walk $inv2.id $fd @('OCR_PROCESSING','PENDING_REVIEW','PENDING_MATCH')
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv2.id)/submit-match" -Headers (AuthHdr $clerk)
$r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv2.id)/submit-approval" -Headers (AuthHdr $clerk)
Write-Host "  Chain=[$($r.approvalChain -join ', ')], current=$($r.currentApproverId)" -ForegroundColor Yellow

Write-Host "`n=== WF-03 T5: FD cannot skip PM (segregation of duties) ===" -ForegroundColor Cyan
Expect-Status 403 { Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv2.id)/approve" -Headers (AuthHdr $fd) }

Write-Host "`n=== WF-03 T6: PM approves -> chain advances to FD (status still PENDING_APPROVAL) ===" -ForegroundColor Cyan
$r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv2.id)/approve" -Headers (AuthHdr $pm)
Write-Host "  status=$($r.status) chainComplete=$($r.chainComplete) next=$($r.nextApproverId)" -ForegroundColor Green

Write-Host "`n=== WF-03 T7: FD approves -> chain complete, status=APPROVED ===" -ForegroundColor Cyan
$r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv2.id)/approve" -Headers (AuthHdr $fd)
Write-Host "  status=$($r.status) chainComplete=$($r.chainComplete)" -ForegroundColor Green

Write-Host "`n=== WF-03 T8: Tier 3 ($75K) routes PM -> FD -> VP ===" -ForegroundColor Cyan
$inv3 = Invoke-RestMethod -Method Post -Uri "$base/invoices" -Headers (AuthHdr $clerk) -ContentType 'application/json' -Body (@{
  invoiceNumber='WF03-T3'; supplierName='Tier3 Supplier'; totalAmount=75000; currency='USD'; plantId='PLT-001'
} | ConvertTo-Json)
Walk $inv3.id $fd @('OCR_PROCESSING','PENDING_REVIEW','PENDING_MATCH')
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv3.id)/submit-match" -Headers (AuthHdr $clerk)
$r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv3.id)/submit-approval" -Headers (AuthHdr $clerk)
Write-Host "  Chain length=$($r.approvalChain.Count) (expect 3)" -ForegroundColor Yellow
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv3.id)/approve" -Headers (AuthHdr $pm)
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv3.id)/approve" -Headers (AuthHdr $fd)
$r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv3.id)/approve" -Headers (AuthHdr $vp)
Write-Host "  Final status after VP approval: $($r.status)" -ForegroundColor Green

Write-Host "`n=== WF-04: count emails captured by Mailpit ===" -ForegroundColor Cyan
Start-Sleep -Seconds 1
$mp = Invoke-RestMethod -Uri "$mailpit/messages"
Write-Host "  Mailpit captured $($mp.total) email(s):"
foreach ($m in $mp.messages) { Write-Host "   - To: $($m.To[0].Address)   Subject: $($m.Subject)" -ForegroundColor Gray }

Write-Host "`n=== WF-05: create an invoice, FORCE pendingApprovalSince into the past, run cron ===" -ForegroundColor Cyan
$invE = Invoke-RestMethod -Method Post -Uri "$base/invoices" -Headers (AuthHdr $clerk) -ContentType 'application/json' -Body (@{
  invoiceNumber='WF05-ESC'; supplierName='Escalation Test'; totalAmount=25000; currency='USD'; plantId='PLT-001'
} | ConvertTo-Json)
Walk $invE.id $fd @('OCR_PROCESSING','PENDING_REVIEW','PENDING_MATCH')
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invE.id)/submit-match" -Headers (AuthHdr $clerk)
$null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invE.id)/submit-approval" -Headers (AuthHdr $clerk)
docker exec martinrea-ap-postgres psql -U martinrea -d martinrea_ap -c "UPDATE invoices SET pending_approval_since = NOW() - INTERVAL '72 hours', last_escalated_at = NULL WHERE id = '$($invE.id)';" | Out-Null
$null = Invoke-RestMethod -Method Delete -Uri "$mailpit/messages"
$result = Invoke-RestMethod -Method Post -Uri "$base/escalation/run-now" -Headers (AuthHdr $fd)
Write-Host "  Escalation pass: checked=$($result.checked) escalated=$($result.escalated)" -ForegroundColor Green
Start-Sleep -Seconds 1
$mp = Invoke-RestMethod -Uri "$mailpit/messages"
Write-Host "  Mailpit captured $($mp.total) escalation email(s):"
foreach ($m in $mp.messages) { Write-Host "   - To: $($m.To[0].Address)   Subject: $($m.Subject)" -ForegroundColor Gray }

Write-Host "`n=== WF-05: re-run cron immediately (expect 0 - already escalated within SLA window) ===" -ForegroundColor Cyan
$result2 = Invoke-RestMethod -Method Post -Uri "$base/escalation/run-now" -Headers (AuthHdr $fd)
Write-Host "  checked=$($result2.checked) escalated=$($result2.escalated) (expect 0)" -ForegroundColor Green

Write-Host "`n=== ALL WF-01/02/03/04/05 SCENARIOS COMPLETE ===" -ForegroundColor Cyan
