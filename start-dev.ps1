$repositoryRoot = Split-Path -Parent $PSCommandPath
$services = @(
	@{
		Name = 'Document processor'
		Directory = Join-Path $repositoryRoot 'document-parser'
		Executable = Join-Path $repositoryRoot 'document-parser\.venv\Scripts\python.exe'
		Command = '.\.venv\Scripts\python.exe -m uvicorn orchestrator_api:app --host 0.0.0.0 --port 8000 --reload'
	}
	@{
		Name = 'Document API'
		Directory = Join-Path $repositoryRoot 'document-parser-api'
		Executable = 'npm'
		Command = 'npm run dev'
	}
	@{
		Name = 'Document UI'
		Directory = Join-Path $repositoryRoot 'document-parser-ui'
		Executable = 'npm'
		Command = 'npm start'
	}
)

foreach ($service in $services) {
	if (-not (Test-Path -LiteralPath $service.Directory)) {
		throw "$($service.Name) directory was not found: $($service.Directory)"
	}

	if ($service.Executable -ne 'npm' -and -not (Test-Path -LiteralPath $service.Executable)) {
		throw "$($service.Name) Python virtual environment was not found: $($service.Executable)"
	}

	$command = "Set-Location -LiteralPath '$($service.Directory)'; $($service.Command)"
	Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoExit', '-Command', $command
}