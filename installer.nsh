; Custom NSIS macros for Stocka installer
; Adds Windows Firewall rules so the LAN sync feature can accept inbound connections
; without a pop-up every time the app starts on a new network.

!macro customInstall
  ; Remove any stale rules from a previous install first, then add fresh ones.
  ; Errors here are intentionally ignored — the user may not have admin rights.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Stocka LAN HTTP"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Stocka LAN Discovery"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Stocka LAN HTTP" dir=in action=allow protocol=TCP localport=7821 description="Stocka POS — LAN sync HTTP API"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Stocka LAN Discovery" dir=in action=allow protocol=UDP localport=7820 description="Stocka POS — LAN auto-discovery beacon"'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Stocka LAN HTTP"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Stocka LAN Discovery"'
!macroend
