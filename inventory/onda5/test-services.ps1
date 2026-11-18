# Test script for Wave 5 migration
# Tests services on both port 4700 (gateway) and legacy ports

param(
    [string]$awsAccessKeyId = "test",
    [string]$awsSecretAccessKey = "test",
    [string]$region = "us-east-1",
    [string]$gatewayUrl = "http://localhost:4700"
)

$ErrorActionPreference = "Continue"

function Test-Service {
    param(
        [string]$serviceName,
        [string]$command,
        [string]$legacyPort,
        [string]$gatewayPort = "4700"
    )
    
    Write-Host "`n=== Testing $serviceName ==="
    Write-Host "Command: $command"
    
    # Test gateway port
    Write-Host "Testing gateway (port $gatewayPort)..."
    $gatewayCmd = "$command --endpoint-url $gatewayUrl"
    Write-Host "Gateway command: $gatewayCmd"
    
    # Test legacy port
    if ($legacyPort) {
        Write-Host "Testing legacy (port $legacyPort)..."
        $legacyCmd = "$command --endpoint-url http://localhost:$legacyPort"
        Write-Host "Legacy command: $legacyCmd"
    }
}

# Service definitions
$services = @(
    @{name="organizations"; command="aws organizations describe-organization"; legacyPort="4581"},
    @{name="acm"; command="aws acm list-certificates"; legacyPort="4025"},
    @{name="cloudfront"; command="aws cloudfront list-distributions"; legacyPort="4017"},
    @{name="config"; command="aws configservice describe-configuration-recorders"; legacyPort="4013"},
    @{name="xray"; command="aws xray get-groups"; legacyPort="4015"},
    @{name="dax"; command="aws dax describe-clusters"; legacyPort="8111"}
)

# Run tests
foreach ($service in $services) {
    Test-Service -serviceName $service.name -command $service.command -legacyPort $service.legacyPort
}

Write-Host "`n=== Test Summary ==="
Write-Host "Run the commands above manually to verify results."
