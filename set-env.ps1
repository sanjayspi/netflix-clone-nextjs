# set-env.ps1
$envFile = Get-Content ".env"

foreach ($line in $envFile) {
    if ($line -match "^\s*#") { continue } # skip comments
    if ($line -match "^\s*$") { continue } # skip empty
    $parts = $line -split "=",2
    $key = $parts[0].Trim()
    $val = $parts[1].Trim().Trim('"')

    if ($key -in @("FRONTEND_BASE")) {
        # Non-secret env
        wrangler pages project secret put $key --project-name ottlaw --env production --value $val
    } else {
        # Secrets
        echo $val | wrangler secret put $key --project-name ottlaw
    }
}
