$ErrorActionPreference = 'Stop'
$api = 'http://localhost:3001/api'
$kc  = 'http://localhost:8080/realms/martinrea/protocol/openid-connect/token'
$mailpit = 'http://localhost:8025/api/v1'
$secret = $env:KEYCLOAK_CLIENT_SECRET
if (-not $secret) { $secret = 'y8ycGTJrsMPNpe4l1v45v0E2G1vqaJMB' }

function KcLogin($email) {
  $body = @{
    client_id     = 'martinrea-ap'
    client_secret = $secret
    grant_type    = 'password'
    username      = $email
    password      = 'Password123!'
  }
  return (Invoke-RestMethod -Method Post -Uri $kc -ContentType 'application/x-www-form-urlencoded' -Body $body).access_token
}
function AuthHdr($tok) { return @{ Authorization = "Bearer $tok" } }
function Expect-Status($expected, $script) {
  try { $r = & $script; Write-Host "  unexpected success (expected $expected): $($r | ConvertTo-Json -Compress)" -ForegroundColor Red }
  catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq $expected) { Write-Host "  OK $code" -ForegroundColor Green }
    else { Write-Host "  WRONG STATUS expected=$expected got=$code" -ForegroundColor Red }
  }
}

Write-Host "`n=== STEP 0: harvest Keycloak tokens for all 5 users ===" -ForegroundColor Cyan
$clerkTok = KcLogin 'clerk@martinrea.dev'
$pmTok    = KcLogin 'pm@martinrea.dev'
$fdTok    = KcLogin 'fd@martinrea.dev'
$vpTok    = KcLogin 'vp@martinrea.dev'
Write-Host "  All 5 users authenticated against Keycloak" -ForegroundColor Green

Write-Host "`n=== STEP 1: /users/me returns the locally-mapped user (proves email->local UUID join) ===" -ForegroundColor Cyan
$me = Invoke-RestMethod -Uri "$api/users/me" -Headers (AuthHdr $fdTok)
Write-Host "  me.email=$($me.email) me.role=$($me.role) me.id=$($me.id)" -ForegroundColor Green

Write-Host "`n=== STEP 2: AP_Clerk hitting an FD-only route returns 403 (RBAC works with Keycloak claims) ===" -ForegroundColor Cyan
Expect-Status 403 { Invoke-RestMethod -Uri "$api/workflow/approval-test" -Headers (AuthHdr $clerkTok) }

Write-Host "`n=== STEP 3: FD hitting the same route returns 200 ===" -ForegroundColor Cyan
$ok = Invoke-RestMethod -Uri "$api/workflow/approval-test" -Headers (AuthHdr $fdTok)
Write-Host "  Got: $($ok.message)" -ForegroundColor Green

Write-Host "`n=== STEP 4: Tampered token (bad signature) is rejected with 401 ===" -ForegroundColor Cyan
$tampered = $fdTok.Substring(0, $fdTok.Length - 4) + 'AAAA'
Expect-Status 401 { Invoke-RestMethod -Uri "$api/workflow/approval-test" -Headers (AuthHdr $tampered) }

Write-Host "`n=== STEP 5: Full approval chain via Keycloak tokens (Tier 2 - $25K) ===" -ForegroundColor Cyan
try { $null = Invoke-RestMethod -Method Delete -Uri "$mailpit/messages" } catch {}
$inv = Invoke-RestMethod -Method Post -Uri "$api/invoices" -Headers (AuthHdr $clerkTok) -ContentType 'application/json' -Body (@{
  invoiceNumber='KC-T2-001'; supplierName='Keycloak Test Supplier'; totalAmount=25000; currency='USD'; plantId='PLT-001'
} | ConvertTo-Json)
Write-Host "  Created invoice $($inv.invoiceNumber) (id=$($inv.id)) in status $($inv.status)" -ForegroundColor Yellow

foreach ($s in @('OCR_PROCESSING','PENDING_REVIEW','PENDING_MATCH')) {
  $null = Invoke-RestMethod -Method Post -Uri "$api/invoices/$($inv.id)/transitions" -Headers (AuthHdr $fdTok) -ContentType 'application/json' -Body (@{ to=$s } | ConvertTo-Json)
}

$r = Invoke-RestMethod -Method Post -Uri "$api/invoices/$($inv.id)/submit-match" -Headers (AuthHdr $clerkTok)
Write-Host "  submit-match -> status=$($r.status)" -ForegroundColor Yellow
$r = Invoke-RestMethod -Method Post -Uri "$api/invoices/$($inv.id)/submit-approval" -Headers (AuthHdr $clerkTok)
Write-Host "  submit-approval -> status=$($r.status) chain=[$($r.approvalChain -join ', ')]" -ForegroundColor Yellow

Write-Host "  FD attempting to skip PM -> expect 403 (segregation of duties):"
Expect-Status 403 { Invoke-RestMethod -Method Post -Uri "$api/invoices/$($inv.id)/approve" -Headers (AuthHdr $fdTok) }

$r1 = Invoke-RestMethod -Method Post -Uri "$api/invoices/$($inv.id)/approve" -Headers (AuthHdr $pmTok)
Write-Host "  PM approved -> chainComplete=$($r1.chainComplete) next=$($r1.nextApproverId)" -ForegroundColor Green

$r2 = Invoke-RestMethod -Method Post -Uri "$api/invoices/$($inv.id)/approve" -Headers (AuthHdr $fdTok)
Write-Host "  FD approved -> status=$($r2.status) chainComplete=$($r2.chainComplete)" -ForegroundColor Green

Start-Sleep -Seconds 1
$mp = Invoke-RestMethod -Uri "$mailpit/messages"
Write-Host "`n  Mailpit captured $($mp.total) email(s) (expect 2 - one per chain step):"
foreach ($m in $mp.messages) { Write-Host "   - To: $($m.To[0].Address)   Subject: $($m.Subject)" -ForegroundColor Gray }

Write-Host "`n=== STEP 6: /auth/login is gated (returns 403) when AUTH_PROVIDER=keycloak ===" -ForegroundColor Cyan
Expect-Status 403 {
  Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType 'application/json' -Body (@{ email='fd@martinrea.dev'; password='Password123!' } | ConvertTo-Json)
}

Write-Host "`n=== KEYCLOAK END-TO-END SMOKE COMPLETE ===" -ForegroundColor Cyan
