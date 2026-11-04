$ErrorActionPreference = 'Stop'

if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') {
  throw 'Redaxa requires Windows x64.'
}

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'exe'
  url64bit       = 'https://github.com/AurelioAvila/redaxa/releases/download/v0.6.19/Redaxa_0.6.19_x64-setup.exe'
  checksum64     = '3dab216692eeea475ca311e4809ffa3f8c75d70f55b93e0aa7c7e6b3c62cf66a'
  checksumType64 = 'sha256'
  silentArgs     = '/S'
  validExitCodes = @(0)
  softwareName   = 'Redaxa'
}

Install-ChocolateyPackage @packageArgs
