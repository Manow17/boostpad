@echo off
rem Builds BoostpadTraining.dll with the Visual Studio C++ build tools and the BakkesMod SDK
rem that comes with BakkesMod (%APPDATA%\bakkesmod\bakkesmod\bakkesmodsdk).
setlocal
set SDK=%APPDATA%\bakkesmod\bakkesmod\bakkesmodsdk
set "VS="
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" for /f "usebackq tokens=*" %%i in (`call "%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS=%%i"
if not defined VS if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" set "VS=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools"
if not defined VS (echo Visual Studio C++ build tools not found & exit /b 1)
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
cd /d "%~dp0"
if not exist build mkdir build
cl /nologo /O2 /EHsc /std:c++17 /MD /LD /W3 /DNOMINMAX /DWIN32_LEAN_AND_MEAN /I"%SDK%\include" BoostpadTraining.cpp /Fo"build\\" /link /LIBPATH:"%SDK%\lib" pluginsdk.lib /OUT:build\BoostpadTraining.dll /IMPLIB:build\BoostpadTraining.lib || exit /b 1
copy /y build\BoostpadTraining.dll ..\assets\bakkesmod\BoostpadTraining.dll >nul
echo built assets\bakkesmod\BoostpadTraining.dll
