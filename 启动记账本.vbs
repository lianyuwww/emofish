Option Explicit
' Flash-free launcher for the Electron app.
' Uses wscript (GUI host) so no console window appears.
' Window style 1 = show normally; electron.exe is a GUI app, so there is no console to hide.
' Portable: paths are resolved relative to this script, so the folder can be moved freely.
Dim fso, sh, root, exe
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
exe = root & "\node_modules\electron\dist\electron.exe"
sh.CurrentDirectory = root
sh.Run """" & exe & """" & " .", 1, False
