@echo off
chcp 65001 >nul
cls
setlocal enabledelayedexpansion

echo ============================================
echo  FAT 운영망 업데이트 + 실행 스크립트
echo  (fat.zip = fat.bundle + frontend\dist 반영 후 서버 실행)
echo ============================================
echo.

cd /d "%~dp0"

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [오류] 이 폴더는 git 저장소가 아닙니다. run_prod.bat 위치를 확인하세요.
    goto :fail
)

echo.
if exist "scp_config.bat" (
    call scp_config.bat
    set /p DOWNLOAD_CONFIRM="중계 서버에서 fat.zip을 새로 받아오시겠습니까? (Y/N, 기본 N): "
    if /i "!DOWNLOAD_CONFIRM!"=="Y" (
        echo        다운로드 중... ^(!RELAY_USER!@!RELAY_HOST!:!RELAY_PATH!^)
        echo        ^(중계 서버 비밀번호를 입력하세요^)
        scp -P !RELAY_PORT! "!RELAY_USER!@!RELAY_HOST!:!RELAY_PATH!" "fat.zip"
        if errorlevel 1 (
            echo [오류] fat.zip 다운로드에 실패했습니다.
            goto :fail
        )
        echo        완료.
    )
) else (
    echo [알림] scp_config.bat이 없어 중계 서버 다운로드를 건너뜁니다. scp_config.bat.example을 복사해서 사용하세요.
)

if not exist "fat.zip" (
    echo [알림] fat.zip이 없어 업데이트 없이 서버만 실행합니다.
    goto :run_server
)

echo [1/5] 로컬 변경 사항 확인 중...
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
echo [2/5] fat.zip 압축 해제 중...
if exist "_fat_extract" (
    rmdir /s /q "_fat_extract"
)
mkdir "_fat_extract"
powershell -NoProfile -Command "Expand-Archive -Path 'fat.zip' -DestinationPath '_fat_extract' -Force"
if errorlevel 1 (
    echo [오류] fat.zip 압축 해제에 실패했습니다.
    goto :fail
)
if not exist "_fat_extract\fat.bundle" (
    echo [오류] fat.zip 안에서 fat.bundle을 찾을 수 없습니다. deploy.bat으로 다시 생성했는지 확인하세요.
    goto :fail
)
if not exist "_fat_extract\dist" (
    echo [오류] fat.zip 안에서 dist 폴더를 찾을 수 없습니다. deploy.bat으로 다시 생성했는지 확인하세요.
    goto :fail
)
echo        완료.

echo.
echo [3/5] fat.bundle로부터 업데이트 반영 중...
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set CURRENT_BRANCH=%%b
git pull "%~dp0_fat_extract\fat.bundle" %CURRENT_BRANCH%
if errorlevel 1 (
    echo [오류] fat.bundle 반영에 실패했습니다. 충돌 여부를 확인한 뒤 다시 실행하세요.
    goto :fail
)
echo        완료. ^(브랜치: %CURRENT_BRANCH%^)

echo.
echo        frontend\dist 갱신 중...
if exist "frontend\dist" (
    rmdir /s /q "frontend\dist"
)
move /y "_fat_extract\dist" "frontend\dist" >nul
rmdir /s /q "_fat_extract"
echo        완료.

:run_server
echo.
echo [4/5] DB 마이그레이션 적용 중 (python backend/migrate.py)...
python backend\migrate.py
if errorlevel 1 (
    echo [오류] DB 마이그레이션에 실패했습니다. 서버를 실행하지 않습니다.
    goto :fail
)
echo        완료.

echo.
echo [5/5] 서버 실행 중...
echo   uvicorn app.main:app --app-dir backend
echo ============================================
uvicorn app.main:app --app-dir backend
goto :end

:fail
if exist "_fat_extract" (
    rmdir /s /q "_fat_extract"
)
echo.
echo 업데이트/실행이 중단되었습니다.
pause
exit /b 1

:end
pause
