# Restarts the game controllers that are connected right now, so a filter driver installed a
# moment ago (HidHide) attaches to them without unplugging them or restarting Windows.
# Run with administrator rights, by OpenW's setup and by OpenW when it installs HidHide.
$pads = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object {
  $_.Class -in 'XnaComposite', 'XboxComposite' -or
  ($_.Class -eq 'HIDClass' -and (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName DEVPKEY_Device_CompatibleIds -ErrorAction SilentlyContinue).Data -contains 'HID_DEVICE_SYSTEM_GAME')
}
foreach ($pad in $pads) { & pnputil.exe /restart-device "$($pad.InstanceId)" | Out-Null }
