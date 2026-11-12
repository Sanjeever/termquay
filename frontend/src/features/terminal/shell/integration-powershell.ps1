param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-f0-9]{64}$')]
    [string]$Token,
    [Parameter(Mandatory = $true)]
    [string]$HostName,
    [switch]$DirectoryOnly
)

if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
    throw 'TermQuay shell integration requires FullLanguage mode.'
}
if (-not $DirectoryOnly -and -not (Get-Module PSReadLine)) {
    throw 'TermQuay command integration requires PSReadLine. Directory reporting can be enabled separately.'
}
if (-not (Test-Path variable:global:__TermQuay)) {
    $global:__TermQuay = @{
        OriginalPrompt = $function:prompt
        OriginalReadLine = $null
        Token = $Token
        HostName = $HostName
        Full = $false
        Running = $false
    }
    function global:prompt {
        $succeeded = $global:?
        Set-StrictMode -Off
        $nativeExitCode = $global:LASTEXITCODE
        $state = $global:__TermQuay
        $esc = [char]27
        $bel = [char]7
        $prefix = ''
        if ($state.Running) {
            $status = [int](-not $succeeded)
            $prefix += "$esc]133;D;$status$bel"
            $state.Running = $false
        }
        if ($state.Full) {
            $prefix += "$esc]133;A$bel"
        }
        if ($pwd.Provider.Name -eq 'FileSystem') {
            $path = $pwd.ProviderPath
            if ([IO.Path]::DirectorySeparatorChar -eq [char]92) {
                $path = $path.Replace('\', '/')
            }
            $uri = [UriBuilder]::new('file', $state.HostName, -1, $path)
            $prefix += "$esc]7;$($uri.Uri.AbsoluteUri)$bel"
        } else {
            $prefix += "$esc]7;file://termquay.invalid/$bel"
        }
        [Console]::Write($prefix)
        $global:LASTEXITCODE = $nativeExitCode
        # Restore failure status for custom prompts after emitting the protocol markers.
        if (-not $succeeded) {
            Write-Error 'failure' -ErrorAction Ignore
        }
        $text = $state.OriginalPrompt.Invoke()
        if ($state.Full) {
            [Console]::Write("$esc]777;termquay;$($state.Token);P;powershell$bel")
            return "$text$esc]133;B$bel"
        }
        return $text
    }
}
$global:__TermQuay.Token = $Token
$global:__TermQuay.HostName = $HostName
if (-not $DirectoryOnly -and -not $global:__TermQuay.Full) {
    $global:__TermQuay.OriginalReadLine = $function:PSConsoleHostReadLine
    function global:PSConsoleHostReadLine {
        $command = $global:__TermQuay.OriginalReadLine.Invoke()
        if (-not [string]::IsNullOrWhiteSpace($command)) {
            $esc = [char]27
            $bel = [char]7
            $bytes = [Text.Encoding]::UTF8.GetBytes($command.Replace("`r`n", "`n"))
            if ($bytes.Length -le 8192) {
                $hex = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
                [Console]::Write("$esc]777;termquay;$($global:__TermQuay.Token);R;$hex$bel")
            }
            $global:__TermQuay.Running = $true
            [Console]::Write("$esc]133;C$bel")
        }
        return $command
    }
    $global:__TermQuay.Full = $true
}
