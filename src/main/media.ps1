# Reads what is playing from Windows' own media controls (the same source as the
# volume flyout), so it works with any app that shows up there: Spotify, Apple
# Music, TIDAL, Deezer, Amazon Music, browsers (YouTube Music, SoundCloud), VLC,
# foobar2000 and so on. No login and no web requests.
# Set by media.js before this script:
#   $action   watch | toggle | next | prev
#   $prefer   a regex on the app id to follow one app only, or '' for "whatever is playing"
# watch prints one JSON line per second: the track, plus the name of the program
# whose window is in front (used to show overlays only while the game is in front).
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

$browsers = 'chrome|msedge|firefox|opera|brave|vivaldi'
function Test-Playing($session) { $session.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing' }
function Get-Session {
  $all = @($manager.GetSessions())
  if ($prefer) {
    $all = @($all | Where-Object { $_.SourceAppUserModelId -match $prefer })
    if (-not $all.Count) { return $null }
  }
  $playing = @($all | Where-Object { Test-Playing $_ })
  if ($playing.Count) {
    # a music app wins over a browser tab when both are playing
    $app = $playing | Where-Object { $_.SourceAppUserModelId -notmatch $browsers } | Select-Object -First 1
    if ($app) { return $app }
    return $playing[0]
  }
  if ($prefer) { return $all[0] }
  $manager.GetCurrentSession()
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

# Which program's window is in front. Asks Windows; does not touch the program itself.
$canSeeFront = $true
try {
  Add-Type -Namespace OpenW -Name Front -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint processId);
'@
} catch { $canSeeFront = $false }
function Get-Front {
  if (-not $canSeeFront) { return '' }
  try {
    $id = [uint32]0
    $null = [OpenW.Front]::GetWindowThreadProcessId([OpenW.Front]::GetForegroundWindow(), [ref]$id)
    (Get-Process -Id $id).ProcessName
  } catch { '' }
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
        playing  = (Test-Playing $session)
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
  $state.front = Get-Front
  [Console]::Out.WriteLine(($state | ConvertTo-Json -Compress))
  Start-Sleep -Milliseconds 1000
}
