@echo off
REM ============================================================
REM SMARTRENT PERFORMANCE TEST RUNNER (Windows)
REM Run all K6 performance test scenarios
REM ============================================================

echo ============================================================
echo SMARTRENT PERFORMANCE TEST SUITE
echo ============================================================
echo.

REM Create results directory if not exists
if not exist "results" mkdir results

REM Check if k6 is installed
where k6 >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: k6 is not installed
    echo Install k6: https://k6.io/docs/getting-started/installation/
    exit /b 1
)

echo Select test to run:
echo 1. User Journey Test (login, browse, search, create, push)
echo 2. Admin Journey Test (login, filter, update status)
echo 3. Core API Test (basic APIs)
echo 4. Full API Test (including slow Search)
echo 5. Run ALL tests sequentially
echo.
set /p choice="Enter choice (1-5): "

if "%choice%"=="1" goto user_test
if "%choice%"=="2" goto admin_test
if "%choice%"=="3" goto core_test
if "%choice%"=="4" goto full_test
if "%choice%"=="5" goto all_tests
goto invalid

:user_test
echo.
echo ============================================================
echo Running: User Journey Test
echo ============================================================
k6 run scenarios/user-journey-test.js
goto end

:admin_test
echo.
echo ============================================================
echo Running: Admin Journey Test
echo ============================================================
k6 run scenarios/admin-journey-test.js
goto end

:core_test
echo.
echo ============================================================
echo Running: Core API Test
echo ============================================================
k6 run smartrent-core-api-test.js
goto end

:full_test
echo.
echo ============================================================
echo Running: Full API Test
echo ============================================================
k6 run smartrent-api-test.js
goto end

:all_tests
echo.
echo Running all tests sequentially...
echo.
echo ============================================================
echo [1/3] Core API Test
echo ============================================================
k6 run smartrent-core-api-test.js
timeout /t 5 /nobreak >nul

echo.
echo ============================================================
echo [2/3] User Journey Test
echo ============================================================
k6 run scenarios/user-journey-test.js
timeout /t 5 /nobreak >nul

echo.
echo ============================================================
echo [3/3] Admin Journey Test
echo ============================================================
k6 run scenarios/admin-journey-test.js
goto end

:invalid
echo Invalid choice
exit /b 1

:end
echo.
echo ============================================================
echo TEST SUITE COMPLETED
echo Results saved in .\results\ directory
echo ============================================================
pause
