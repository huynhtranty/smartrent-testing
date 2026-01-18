#!/bin/bash

# ============================================================
# SMARTRENT PERFORMANCE TEST RUNNER
# Run all K6 performance test scenarios
# ============================================================

echo "============================================================"
echo "SMARTRENT PERFORMANCE TEST SUITE"
echo "============================================================"
echo ""

# Create results directory if not exists
mkdir -p results

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to run a test
run_test() {
    local test_name=$1
    local test_file=$2

    echo ""
    echo "============================================================"
    echo -e "${YELLOW}Running: ${test_name}${NC}"
    echo "============================================================"
    echo ""

    k6 run "$test_file"

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}[PASS] ${test_name} completed successfully${NC}"
    else
        echo -e "${RED}[FAIL] ${test_name} failed${NC}"
    fi

    echo ""
    sleep 5  # Wait between tests
}

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
    echo -e "${RED}Error: k6 is not installed${NC}"
    echo "Install k6: https://k6.io/docs/getting-started/installation/"
    exit 1
fi

# Menu
echo "Select test to run:"
echo "1. User Journey Test (login, browse, search, create, push)"
echo "2. Admin Journey Test (login, filter, update status)"
echo "3. Core API Test (basic APIs)"
echo "4. Full API Test (including slow Search)"
echo "5. Run ALL tests"
echo ""
read -p "Enter choice (1-5): " choice

case $choice in
    1)
        run_test "User Journey Test" "scenarios/user-journey-test.js"
        ;;
    2)
        run_test "Admin Journey Test" "scenarios/admin-journey-test.js"
        ;;
    3)
        run_test "Core API Test" "smartrent-core-api-test.js"
        ;;
    4)
        run_test "Full API Test" "smartrent-api-test.js"
        ;;
    5)
        echo "Running all tests sequentially..."
        run_test "Core API Test" "smartrent-core-api-test.js"
        run_test "User Journey Test" "scenarios/user-journey-test.js"
        run_test "Admin Journey Test" "scenarios/admin-journey-test.js"
        ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""
echo "============================================================"
echo "TEST SUITE COMPLETED"
echo "Results saved in ./results/ directory"
echo "============================================================"
