# Reads what is playing from Windows' own media controls (the same source as the
# volume flyout). No login and no web requests. $action is set by media.js:
#   watch  - print one JSON line per second describing the current track
#   toggle / next / prev - press that button on the session, then exit
# Prefers the Spotify app; otherwise uses whatever Windows says is current
# (for example the Spotify web player in a browser).
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } |
  Select-Object -First 1
function Await($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  if (-not $task.Wait(4000)) { throw 'timed out' }
  $task.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
# called through reflection: PowerShell cannot pick the overload for a WinRT stream object itself
$asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Get-Session {
  $spotify = @($manager.GetSessions()) | Where-Object { $_.SourceAppUserModelId -match 'spotify' } | Select-Object -First 1
  if ($spotify) { $spotify } else { $manager.GetCurrentSession() }
}

if ($action -ne 'watch') {
  $session = Get-Session
  if ($session) {
    if ($action -eq 'toggle') { $null = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
    elseif ($action -eq 'next') { $null = Await ($session.TrySkipNextAsync()) ([bool]) }
    elseif ($action -eq 'prev') { $null = Await ($session.TrySkipPreviousAsync()) ([bool]) }
  }
  exit 0
}

$artFor = ''
while ($true) {
  $state = @{ found = $false }
  try {
    $session = Get-Session
    if ($session) {
      $media = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $timeline = $session.GetTimelineProperties()
      $track = "$($media.Title)|$($media.Artist)"
      $state = @{
        found    = $true
        app      = $session.SourceAppUserModelId
        title    = $media.Title
        artist   = $media.Artist
        album    = $media.AlbumTitle
        playing  = ($session.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing')
        position = [math]::Round($timeline.Position.TotalSeconds, 1)
        duration = [math]::Round($timeline.EndTime.TotalSeconds, 1)
        updated  = $timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
      }
      # cover art: sent once per track (it can arrive a moment after the title)
      if ($track -ne $artFor -and $media.Thumbnail) {
        try {
          $stream = Await ($media.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
          $memory = New-Object System.IO.MemoryStream
          $asStream.Invoke($null, @($stream)).CopyTo($memory)
          if ($memory.Length -gt 0 -and $memory.Length -lt 2000000) {
            $state.art = [Convert]::ToBase64String($memory.ToArray())
            $artFor = $track
          }
        } catch { }
      }
    }
  } catch {
    $state = @{ found = $false; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($state | ConvertTo-Json -Compress))
  Start-Sleep -Milliseconds 1000
}
