<#
.SYNOPSIS
Packages browser-extension/ and publishes it to the Chrome Web Store through the v2 API.

.DESCRIPTION
One-time setup: run with -SaveCredential, enter the publisher ID (Developer Dashboard >
Publisher > Settings) and the path of the service account's JSON key. The key is stored
with Windows DPAPI under %APPDATA%\Redaxa-Store, readable only by this Windows user;
delete the downloaded key file afterwards.

A release run zips the extension (tests and notes excluded), uploads it, then submits it
for review with automatic publication after approval. Google's review time is outside
the script's control; it reports the state the item reached.

.EXAMPLE
pwsh scripts/Publish-ChromeWebStore.ps1 -SaveCredential
pwsh scripts/Publish-ChromeWebStore.ps1 -DryRun
pwsh scripts/Publish-ChromeWebStore.ps1
#>
[CmdletBinding(DefaultParameterSetName = 'Publish')]
param(
    [Parameter(ParameterSetName = 'Credential', Mandatory)][switch]$SaveCredential,
    [Parameter(ParameterSetName = 'Publish')][string]$ItemId = 'clkobbjoaegkgnmkibjghlboeoplpmok',
    # Only report the item's current store status.
    [Parameter(ParameterSetName = 'Publish')][switch]$Status,
    # Upload the package as a draft without submitting it for review.
    [Parameter(ParameterSetName = 'Publish')][switch]$NoPublish,
    # Build the package without contacting the store.
    [Parameter(ParameterSetName = 'Publish')][switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$credentialPath = Join-Path $env:APPDATA 'Redaxa-Store/chrome-web-store.json'
$api = 'https://chromewebstore.googleapis.com'

if ($SaveCredential) {
    $publisher = (Read-Host 'Publisher ID').Trim()
    $keyPath = (Read-Host 'Path to the service account JSON key').Trim('"', ' ')
    $key = Get-Content -LiteralPath $keyPath -Raw
    if (($key | ConvertFrom-Json).type -ne 'service_account') { throw 'That file is not a service account key.' }
    New-Item -ItemType Directory -Force (Split-Path $credentialPath) | Out-Null
    [ordered]@{ publisherId = $publisher; serviceAccountKey = ConvertFrom-SecureString (ConvertTo-SecureString $key -AsPlainText -Force) } |
        ConvertTo-Json | Set-Content -LiteralPath $credentialPath -Encoding utf8
    Write-Host "Saved to $credentialPath (key protected with DPAPI). You can now delete $keyPath."
    return
}

# 1. Package exactly what the extension loads: no tests, no notes.
$source = Join-Path $PSScriptRoot '../browser-extension'
$version = (Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw | ConvertFrom-Json).version
$work = Join-Path ([IO.Path]::GetTempPath()) "redaxa-extension-$version"
Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
$stage = New-Item -ItemType Directory -Force (Join-Path $work 'stage')
Copy-Item -Path "$source/*" -Destination $stage -Recurse -Exclude '*.test.mjs', '*.md'
$zip = Join-Path $work "redaxa-extension-$version.zip"
Compress-Archive -Path "$stage/*" -DestinationPath $zip
Write-Host "Package $zip  version $version  SHA256 $((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash)"
if ($DryRun) { Write-Host 'Dry run: nothing sent.'; return }

# 2. Exchange a signed JWT for an access token (service account flow).
if (-not (Test-Path -LiteralPath $credentialPath)) { throw 'No Chrome Web Store credential. Run with -SaveCredential first.' }
$cred = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
$key = [Net.NetworkCredential]::new('', (ConvertTo-SecureString $cred.serviceAccountKey)).Password | ConvertFrom-Json
function ConvertTo-Base64Url([byte[]]$Bytes) { [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$unsigned = (ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes('{"alg":"RS256","typ":"JWT"}'))) + '.' +
    (ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes((@{
                    iss = $key.client_email; scope = 'https://www.googleapis.com/auth/chromewebstore'
                    aud = $key.token_uri; iat = $now; exp = $now + 600
                } | ConvertTo-Json -Compress))))
$rsa = [Security.Cryptography.RSA]::Create()
try {
    $rsa.ImportFromPem($key.private_key)
    $signature = $rsa.SignData([Text.Encoding]::UTF8.GetBytes($unsigned), 'SHA256', [Security.Cryptography.RSASignaturePadding]::Pkcs1)
} finally { $rsa.Dispose() }
$token = (Invoke-RestMethod -Method Post -Uri $key.token_uri -Body @{
        grant_type = 'urn:ietf:params:oauth:grant-type:jwt-bearer'; assertion = "$unsigned.$(ConvertTo-Base64Url $signature)"
    }).access_token
$headers = @{ Authorization = "Bearer $token" }
$item = "publishers/$($cred.publisherId)/items/$ItemId"
if ($Status) { Invoke-RestMethod -Uri "$api/v2/${item}:fetchStatus" -Headers $headers | ConvertTo-Json -Depth 10; return }

# 3. Upload; large packages finish asynchronously.
$upload = Invoke-RestMethod -Method Post -Uri "$api/upload/v2/${item}:upload" -Headers $headers -ContentType 'application/zip' -InFile $zip
$state = $upload.uploadState
while ($state -eq 'IN_PROGRESS') {
    Start-Sleep -Seconds 10
    $state = (Invoke-RestMethod -Uri "$api/v2/${item}:fetchStatus" -Headers $headers).lastAsyncUploadState
}
if ($state -ne 'SUCCEEDED') { throw "Upload ended in state $state." }
Write-Host "Uploaded version $version."
if ($NoPublish) { Write-Host 'Draft only: not submitted for review.'; return }

# 4. Submit for review; Google publishes automatically once it is approved.
$publish = Invoke-RestMethod -Method Post -Uri "$api/v2/${item}:publish" -Headers $headers -ContentType 'application/json' -Body '{}'
Write-Host "Submitted version ${version}: $($publish.state)"
if ($publish.state -in 'REJECTED', 'CANCELLED') { throw "The store returned $($publish.state)." }
