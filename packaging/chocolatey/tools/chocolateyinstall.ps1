$ErrorActionPreference = 'Stop'

if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') {
  throw 'Redaxa requires Windows x64.'
}

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'exe'
  url64bit       = 'https://github.com/AurelioAvila/redaxa/releases/download/v0.6.20/Redaxa_0.6.20_x64-setup.exe'
  checksum64     = '26baa800afbb9123a1b08c2364a356f83e94fcbb6ac1de4087093ecd7d0e2dd5'
  checksumType64 = 'sha256'
  silentArgs     = '/S'
  validExitCodes = @(0)
  softwareName   = 'Redaxa'
}

Install-ChocolateyPackage @packageArgs
