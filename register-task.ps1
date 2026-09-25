$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c C:\Users\behzad\tender-radar\watchdog.cmd"
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd
Register-ScheduledTask -TaskName "TenderRadarWatchdog" -Action $Action -Trigger $Trigger -Settings $Settings -Description "Keep tender-radar webapp alive on port 3731" -Force
Write-Host "Task registered OK"
