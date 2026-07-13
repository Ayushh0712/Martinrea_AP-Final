# =============================================================================
#  Full backend smoke test (LOCAL auth mode) - workflow + OCR APIs.
#  Exercises every HTTP endpoint and prints a PASS/FAIL summary.
#  Prereqs: docker stack up, `npm run seed:all`, app running on :3001.
# =============================================================================
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3001/api'
$sample = Join-Path $PSScriptRoot '..\sample-invoice.pdf'
if (-not (Test-Path $sample)) {
  $src = 'D:\Martinrea\Martinrea\uploads\processed\oci-1781167682764-Demo_Invoice_1.pdf'
  if (Test-Path $src) { Copy-Item $src $sample -Force }
}

$script:results = @()
function Rec($name, $ok, $detail) {
  $script:results += [pscustomobject]@{ API = $name; Result = $(if ($ok) { 'PASS' } else { 'FAIL' }); Detail = $detail }
  Write-Host ("  [{0}] {1}  {2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $detail) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
}
function Req($method, $url, $token, $body) {
  $h = @{}; if ($token) { $h.Authorization = "Bearer $token" }
  $p = @{ Method = $method; Uri = $url; Headers = $h }
  if ($null -ne $body) { $p.ContentType = 'application/json'; $p.Body = ($body | ConvertTo-Json -Depth 8) }
  return Invoke-RestMethod @p
}
# Asserts a call SUCCEEDS
function Ok($name, $method, $url, $token, $body) {
  try { $r = Req $method $url $token $body; Rec $name $true "$method $url"; return $r }
  catch { Rec $name $false ("$method $url -> " + $_.Exception.Response.StatusCode.value__); return $null }
}
# Asserts a call FAILS with a specific status (RBAC / validation)
function Deny($name, $expected, $method, $url, $token, $body) {
  try { $null = Req $method $url $token $body; Rec $name $false "$method $url -> unexpected success (wanted $expected)" }
  catch { $c = $_.Exception.Response.StatusCode.value__; Rec $name ($c -eq $expected) "$method $url -> $c (wanted $expected)" }
}
function Walk($id, $tok, $statuses) { foreach ($s in $statuses) { $null = Req POST "$base/invoices/$id/transitions" $tok @{ to = $s } } }

Write-Host "`n========== AUTH / HEALTH ==========" -ForegroundColor Magenta
$health = Ok 'GET /health (public)' GET "$base/health" $null $null
$clerk = (Req POST "$base/auth/login" $null @{ email = 'clerk@martinrea.dev'; password = 'Password123!' }).accessToken
$pm    = (Req POST "$base/auth/login" $null @{ email = 'pm@martinrea.dev';    password = 'Password123!' }).accessToken
$fd    = (Req POST "$base/auth/login" $null @{ email = 'fd@martinrea.dev';    password = 'Password123!' }).accessToken
Rec 'POST /auth/login (clerk, pm, fd)' ($clerk -and $pm -and $fd) 'tokens issued'
Deny 'POST /auth/login (bad creds -> 401)' 401 POST "$base/auth/login" $null @{ email = 'fd@martinrea.dev'; password = 'wrong' }
Ok   'GET /users/me' GET "$base/users/me" $fd $null
Deny 'GET /(no token) -> 401' 401 GET "$base/invoices" $null $null

Write-Host "`n========== RBAC ==========" -ForegroundColor Magenta
Ok   'GET /workflow/approval-test (FD)' GET "$base/workflow/approval-test" $fd $null
Deny 'GET /workflow/approval-test (clerk -> 403)' 403 GET "$base/workflow/approval-test" $clerk $null
Ok   'GET /audit-logs (FD)' GET "$base/audit-logs?limit=5" $fd $null
Deny 'GET /audit-logs (clerk -> 403)' 403 GET "$base/audit-logs" $clerk $null

Write-Host "`n========== USERS ==========" -ForegroundColor Magenta
$rnd = Get-Random
Ok   'POST /users (FD creates user)' POST "$base/users" $fd @{ email = "smoke$rnd@martinrea.dev"; fullName = 'Smoke User'; password = 'Password123!'; role = 'AP_Clerk'; plantId = 'PLT-001' }
Deny 'POST /users (clerk -> 403)' 403 POST "$base/users" $clerk @{ email = "smoke2$rnd@martinrea.dev"; fullName = 'X Y'; password = 'Password123!'; role = 'AP_Clerk' }

Write-Host "`n========== INVOICES (workflow) ==========" -ForegroundColor Magenta
# --- Happy path: create -> review -> match -> approve ---
$a = Ok 'POST /invoices (create)' POST "$base/invoices" $clerk @{ invoiceNumber = "BK-$rnd-A"; supplierName = 'Smoke A'; totalAmount = 5000; currency = 'USD'; plantId = 'PLT-001' }
Ok   'GET /invoices (list)' GET "$base/invoices?limit=5" $fd $null
Ok   'GET /invoices/:id' GET "$base/invoices/$($a.id)" $fd $null
Ok   'GET /invoices/:id/allowed-transitions' GET "$base/invoices/$($a.id)/allowed-transitions" $fd $null
Ok   'POST /invoices/:id/transitions (FD)' POST "$base/invoices/$($a.id)/transitions" $fd @{ to = 'OCR_PROCESSING' }
$null = Req POST "$base/invoices/$($a.id)/transitions" $fd @{ to = 'PENDING_REVIEW' }
Ok   'POST /invoices/:id/submit-review (clerk)' POST "$base/invoices/$($a.id)/submit-review" $clerk $null
$m = Ok 'POST /invoices/:id/submit-match (clerk)' POST "$base/invoices/$($a.id)/submit-match" $clerk $null
$m = Ok 'POST /invoices/:id/submit-approval (clerk)' POST "$base/invoices/$($a.id)/submit-approval" $clerk $null
Deny 'POST /invoices/:id/approve (wrong approver FD -> 403)' 403 POST "$base/invoices/$($a.id)/approve" $fd $null
Ok   'POST /invoices/:id/approve (PM)' POST "$base/invoices/$($a.id)/approve" $pm $null

# --- Reject path ---
$b = Req POST "$base/invoices" $clerk @{ invoiceNumber = "BK-$rnd-B"; supplierName = 'Smoke B'; totalAmount = 6000; currency = 'USD'; plantId = 'PLT-001' }
Walk $b.id $fd @('OCR_PROCESSING', 'PENDING_REVIEW', 'PENDING_MATCH')
$null = Req POST "$base/invoices/$($b.id)/submit-match" $clerk
$null = Req POST "$base/invoices/$($b.id)/submit-approval" $clerk
Ok   'POST /invoices/:id/reject (PM, reason)' POST "$base/invoices/$($b.id)/reject" $pm @{ reason = 'Smoke test rejection' }

# --- Exception path ---
$c = Req POST "$base/invoices" $clerk @{ invoiceNumber = "BK-$rnd-C"; supplierName = 'Smoke C'; totalAmount = 7000; currency = 'USD'; plantId = 'PLT-001' }
Walk $c.id $fd @('OCR_PROCESSING', 'PENDING_REVIEW', 'PENDING_MATCH')
Ok   'POST /invoices/:id/flag-exception' POST "$base/invoices/$($c.id)/flag-exception" $clerk $null

Write-Host "`n========== ESCALATION ==========" -ForegroundColor Magenta
Ok   'POST /escalation/run-now (FD)' POST "$base/escalation/run-now" $fd $null
Deny 'POST /escalation/run-now (clerk -> 403)' 403 POST "$base/escalation/run-now" $clerk $null

Write-Host "`n========== OCR pipeline ==========" -ForegroundColor Magenta
Ok 'GET /ocr/invoices/stats' GET "$base/ocr/invoices/stats" $fd $null
Ok 'GET /ocr/invoices/review-queue' GET "$base/ocr/invoices/review-queue?limit=5" $fd $null
Ok 'GET /ocr/invoices (list)' GET "$base/ocr/invoices?limit=5" $fd $null

# upload (multipart, async)
$upJson = curl.exe -s -X POST "$base/ocr/invoices/upload" -H "Authorization: Bearer $fd" -F "file=@$sample;type=application/pdf" | ConvertFrom-Json
Rec 'POST /ocr/invoices/upload' ($upJson.success -eq $true) "invoiceId=$($upJson.invoiceId)"

# extract (multipart, sync) -> commit
$exJson = curl.exe -s -X POST "$base/ocr/invoices/extract" -H "Authorization: Bearer $fd" -F "file=@$sample;type=application/pdf" | ConvertFrom-Json
Rec 'POST /ocr/invoices/extract' ($null -ne $exJson.stagingId) "stagingId=$($exJson.stagingId)"
$cm = Ok 'POST /ocr/invoices/commit' POST "$base/ocr/invoices/commit" $fd @{ stagingId = $exJson.stagingId; supplierName = 'Smoke OCR'; totalAmount = 99.99; currency = 'USD'; confidenceScore = 100 }
Ok 'GET /ocr/invoices/:id' GET "$base/ocr/invoices/$($cm.invoice.id)" $fd $null

# file download
$code = (curl.exe -s -o NUL -w "%{http_code}" "$base/ocr/invoices/$($cm.invoice.id)/file" -H "Authorization: Bearer $fd")
Rec 'GET /ocr/invoices/:id/file' ($code -eq '200') "http=$code"

# retry
Ok 'POST /ocr/invoices/:id/retry' POST "$base/ocr/invoices/$($upJson.invoiceId)/retry" $fd $null

# OCI (live bucket)
$oci = Ok 'GET /ocr/oci/files' GET "$base/ocr/oci/files" $fd $null
$obj = ($oci.files | ForEach-Object { if ($_ -is [string]) { $_ } else { $_.name } } | Where-Object { $_ -match '\.pdf$' } | Select-Object -First 1)
if ($obj) {
  Ok 'POST /ocr/oci/extract' POST "$base/ocr/oci/extract" $fd @{ objectName = "$obj" }
  Ok 'POST /ocr/oci/process' POST "$base/ocr/oci/process" $fd @{ objectName = "$obj" }
}
Deny 'POST /ocr/oci/process (bad type -> 400)' 400 POST "$base/ocr/oci/process" $fd @{ objectName = 'notes.txt' }

Write-Host "`n================= SUMMARY =================" -ForegroundColor Magenta
$script:results | Format-Table -AutoSize
$pass = ($script:results | Where-Object Result -eq 'PASS').Count
$fail = ($script:results | Where-Object Result -eq 'FAIL').Count
Write-Host ("TOTAL: {0}  PASS: {1}  FAIL: {2}" -f $script:results.Count, $pass, $fail) -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
Remove-Item $sample -ErrorAction SilentlyContinue
