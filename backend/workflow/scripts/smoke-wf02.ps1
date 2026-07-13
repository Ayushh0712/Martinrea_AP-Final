$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3001/api'

function Login($email, $password) {
  $body = @{ email = $email; password = $password } | ConvertTo-Json
  $r = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $body
  return $r.accessToken
}

function AuthHdr($tok) { return @{ Authorization = "Bearer $tok" } }

function Expect-Status($expected, $script) {
  try {
    $result = & $script
    Write-Host "  unexpected success: $($result | ConvertTo-Json -Compress -Depth 5)" -ForegroundColor Red
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $body = $reader.ReadToEnd()
    if ($code -eq $expected) {
      Write-Host "  OK $code - $body" -ForegroundColor Green
    } else {
      Write-Host "  WRONG STATUS (expected $expected, got $code) - $body" -ForegroundColor Red
    }
  }
}

$clerk = Login 'clerk@martinrea.dev' 'Password123!'
$pm    = Login 'pm@martinrea.dev'    'Password123!'
$fd    = Login 'fd@martinrea.dev'    'Password123!'

Write-Host "`n=== T1: Create new invoice (AP_Clerk) and inspect allowed transitions ===" -ForegroundColor Cyan
$inv1 = Invoke-RestMethod -Method Post -Uri "$base/invoices" -Headers (AuthHdr $clerk) -ContentType 'application/json' -Body (@{
  invoiceNumber='INV-WF02-A'; supplierName='Test Supplier A'; totalAmount=2500; currency='USD'; ingestionChannel='PORTAL'
} | ConvertTo-Json)
Write-Host "  Created $($inv1.invoiceNumber) status=$($inv1.status) id=$($inv1.id)" -ForegroundColor Yellow
$allow = Invoke-RestMethod -Uri "$base/invoices/$($inv1.id)/allowed-transitions" -Headers (AuthHdr $clerk)
Write-Host "  Allowed from $($allow.currentStatus): $($allow.allowedTransitions -join ', ')"

Write-Host "`n=== T2: Illegal transition RECEIVED -> APPROVED (expect 409) ===" -ForegroundColor Cyan
Expect-Status 409 { Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv1.id)/transitions" -Headers (AuthHdr $fd) -ContentType 'application/json' -Body '{"to":"APPROVED"}' }

Write-Host "`n=== T3: Walk happy path RECEIVED -> OCR_PROCESSING -> PENDING_REVIEW -> PENDING_MATCH ===" -ForegroundColor Cyan
foreach ($s in @('OCR_PROCESSING','PENDING_REVIEW','PENDING_MATCH')) {
  $r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv1.id)/transitions" -Headers (AuthHdr $fd) -ContentType 'application/json' -Body (@{ to=$s } | ConvertTo-Json)
  Write-Host "  -> $($r.status)" -ForegroundColor Green
}

Write-Host "`n=== T4a: AP_Clerk calls submit-match -> MATCHED ===" -ForegroundColor Cyan
$r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv1.id)/submit-match" -Headers (AuthHdr $clerk)
Write-Host "  Status after submit-match: $($r.status)" -ForegroundColor Green

Write-Host "`n=== T4b: AP_Clerk calls submit-approval -> PENDING_APPROVAL ===" -ForegroundColor Cyan
$r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv1.id)/submit-approval" -Headers (AuthHdr $clerk)
Write-Host "  Status after submit-approval: $($r.status)" -ForegroundColor Green

Write-Host "`n=== T5: AP_Clerk tries to APPROVE (expect 403 - WF-01 RBAC still active) ===" -ForegroundColor Cyan
Expect-Status 403 { Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv1.id)/approve" -Headers (AuthHdr $clerk) }

Write-Host "`n=== T6: Plant_Manager approves (expect 200) ===" -ForegroundColor Cyan
$r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv1.id)/approve" -Headers (AuthHdr $pm)
Write-Host "  Status=$($r.status)" -ForegroundColor Green

Write-Host "`n=== T7: APPROVED is terminal - any transition rejected (expect 409) ===" -ForegroundColor Cyan
Expect-Status 409 { Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv1.id)/transitions" -Headers (AuthHdr $fd) -ContentType 'application/json' -Body '{"to":"PENDING_REVIEW"}' }

Write-Host "`n=== T8: MXN invoice can reach MATCHED (CFDI guard removed) ===" -ForegroundColor Cyan
$mx = Invoke-RestMethod -Method Post -Uri "$base/invoices" -Headers (AuthHdr $fd) -ContentType 'application/json' -Body (@{
  invoiceNumber='INV-WF02-MX'; supplierName='MX Test'; totalAmount=900; currency='MXN'; ingestionChannel='PORTAL'; plantId='PLT-MX-001'
} | ConvertTo-Json)
Write-Host "  Created MX invoice id=$($mx.id)" -ForegroundColor Yellow
foreach ($s in @('OCR_PROCESSING','PENDING_REVIEW','PENDING_MATCH','MATCHED')) {
  $r = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($mx.id)/transitions" -Headers (AuthHdr $fd) -ContentType 'application/json' -Body (@{ to=$s } | ConvertTo-Json)
}
Write-Host "  Final status=$($r.status)" -ForegroundColor Green

Write-Host "`n=== T9: Reject flow + rework path (PENDING_APPROVAL -> REJECTED -> PENDING_REVIEW) ===" -ForegroundColor Cyan
$inv9 = Invoke-RestMethod -Method Post -Uri "$base/invoices" -Headers (AuthHdr $fd) -ContentType 'application/json' -Body (@{
  invoiceNumber='INV-WF02-REJ'; supplierName='Reject Test'; totalAmount=300; currency='USD'
} | ConvertTo-Json)
foreach ($s in @('OCR_PROCESSING','PENDING_REVIEW','PENDING_MATCH','MATCHED','PENDING_APPROVAL')) {
  $null = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv9.id)/transitions" -Headers (AuthHdr $fd) -ContentType 'application/json' -Body (@{ to=$s } | ConvertTo-Json)
}
$rej = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv9.id)/reject" -Headers (AuthHdr $fd) -ContentType 'application/json' -Body (@{ reason='Amount mismatch with PO line 3' } | ConvertTo-Json)
Write-Host "  After reject: status=$($rej.status), reason=$($rej.rejectionReason)" -ForegroundColor Green
$rew = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($inv9.id)/transitions" -Headers (AuthHdr $fd) -ContentType 'application/json' -Body '{"to":"PENDING_REVIEW"}'
Write-Host "  After rework (REJECTED -> PENDING_REVIEW): status=$($rew.status)" -ForegroundColor Green

Write-Host "`n=== ALL WF-02 SCENARIOS COMPLETE ===" -ForegroundColor Cyan
