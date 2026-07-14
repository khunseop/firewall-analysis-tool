@echo off
chcp 65001 >nul
cls
setlocal enabledelayedexpansion

echo ============================================
echo  FAT 운영망 업데이트 + 실행 스크립트
echo  (fat.bundle 반영 + dist.zip 적용 + 서버 실행)
echo ============================================
echo.

cd /d "%~dp0"

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [오류] 이 폴더는 git 저장소가 아닙니다. run_prod.bat 위치를 확인하세요.
    goto :fail
)

if not exist "fat.bundle" (
    echo [오류] fat.bundle 파일을 찾을 수 없습니다. 개발망에서 만든 fat.bundle을 이 폴더에 복사하세요.
    goto :fail
)

if not exist "dist.zip" (
    echo [오류] dist.zip 파일을 찾을 수 없습니다. 개발망에서 만든 dist.zip을 이 폴더에 복사하세요.
    goto :fail
)

echo [1/4] 로컬 변경 사항 확인 중...
set DIRTY=
for /f "delims=" %%i in ('git status --porcelain') do set DIRTY=1
if defined DIRTY (
    echo [알림] 커밋되지 않은 로컬 변경 사항이 있어 임시로 보관합니다 ^(git stash^).
    git stash push -u -m "run_prod.bat auto-stash %date% %time%"
    if errorlevel 1 (
        echo [오류] stash에 실패했습니다. 수동으로 git status를 확인한 뒤 다시 실행하세요.
        goto :fail
    )
    echo        저장된 변경 사항은 "git stash list"로 확인, "git stash pop"으로 복원할 수 있습니다.
) else (
    echo        로컬 변경 사항 없음.
)

echo.
echo [2/4] fat.bundle로부터 업데이트 반영 중...
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set CURRENT_BRANCH=%%b
git pull "%~dp0fat.bundle" %CURRENT_BRANCH%
if errorlevel 1 (
    echo [오류] fat.bundle 반영에 실패했습니다. 충돌 여부를 확인한 뒤 다시 실행하세요.
    goto :fail
)
echo        완료. ^(브랜치: %CURRENT_BRANCH%^)

echo.
echo [3/4] frontend\dist 갱신 중 (dist.zip 압축 해제)...
if exist "frontend\dist" (
    rmdir /s /q "frontend\dist"
)
mkdir "frontend\dist"
powershell -NoProfile -Command "Expand-Archive -Path 'dist.zip' -DestinationPath 'frontend\dist' -Force"
if errorlevel 1 (
    echo [오류] dist.zip 압축 해제에 실패했습니다.
    goto :fail
)
echo        완료.

echo.
echo [4/4] 서버 실행 중...
echo   uvicorn app.main:app --app-dir backend
echo ============================================
uvicorn app.main:app --app-dir backend
goto :end

:fail
echo.
echo 업데이트/실행이 중단되었습니다.
pause
exit /b 1

:end
pause
