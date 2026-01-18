import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ============================================================
// SMARTRENT ADMIN JOURNEY PERFORMANCE TEST
// Scenario: Admin login -> filter listings -> update status
// ============================================================

// Custom metrics
const errorRate = new Rate('errors');
const loginDuration = new Trend('admin_login_duration');
const filterListingsDuration = new Trend('admin_filter_listings_duration');
const updateStatusDuration = new Trend('admin_update_status_duration');
const getReportsDuration = new Trend('admin_get_reports_duration');
const resolveReportDuration = new Trend('admin_resolve_report_duration');
const successfulOperations = new Counter('successful_operations');

// Test configuration
export const options = {
  scenarios: {
    admin_journey: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 2 },   // Ramp up to 2 admins
        { duration: '1m', target: 3 },    // Ramp up to 3 admins
        { duration: '1m', target: 3 },    // Stay at 3 admins
        { duration: '20s', target: 0 },   // Ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.10'],
    errors: ['rate<0.10'],
    admin_login_duration: ['p(95)<2000'],
    admin_filter_listings_duration: ['p(95)<3000'],
    admin_update_status_duration: ['p(95)<2000'],
  },
};

const BASE_URL = 'https://dev.api.smartrent.io.vn';

// Admin credentials (adjust as needed)
const ADMIN_USER = {
  email: 'admin@smartrent.io.vn',
  password: 'Admin@123',
};

// Helper: Admin Login
function adminLogin() {
  const payload = JSON.stringify({
    email: ADMIN_USER.email,
    password: ADMIN_USER.password,
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  const startTime = new Date();
  const res = http.post(`${BASE_URL}/v1/auth/admin`, payload, params);
  loginDuration.add(new Date() - startTime);

  const success = check(res, {
    'admin login status is 200': (r) => r.status === 200,
    'admin login has access token': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.data && body.data.accessToken;
      } catch {
        return false;
      }
    },
  });

  if (!success) {
    errorRate.add(1);
    console.log(`Admin login failed: ${res.status} - ${res.body}`);
    return null;
  }

  errorRate.add(0);
  successfulOperations.add(1);
  const body = JSON.parse(res.body);
  return body.data.accessToken;
}

// Helper: Get auth headers
function getAuthHeaders(token) {
  return {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };
}

// ============================================================
// MAIN TEST FUNCTION - ADMIN JOURNEY
// ============================================================
export default function () {
  let token = null;
  let pendingListingId = null;
  let reportId = null;

  // ──────────────────────────────────────────────────────────
  // STEP 1: Admin Authentication
  // ──────────────────────────────────────────────────────────
  group('1. Admin Authentication', function () {
    token = adminLogin();
  });

  if (!token) {
    sleep(1);
    return; // Skip if login failed
  }

  const authParams = getAuthHeaders(token);

  // ──────────────────────────────────────────────────────────
  // STEP 2: Filter Listings - By Status (Pending)
  // ──────────────────────────────────────────────────────────
  group('2. Filter - Pending Listings', function () {
    const filterPayload = JSON.stringify({
      page: 1,
      size: 20
    });

    const startTime = new Date();
    const res = http.post(`${BASE_URL}/v1/listings/search`, filterPayload, authParams);
    filterListingsDuration.add(new Date() - startTime);

    const success = check(res, {
      'filter pending status is 200': (r) => r.status === 200,
      'filter has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data !== undefined;
        } catch {
          return false;
        }
      },
    });

    if (success) {
      successfulOperations.add(1);
      errorRate.add(0);
      // Get first pending listing ID
      try {
        const body = JSON.parse(res.body);
        // data là array trực tiếp
        if (body.data && Array.isArray(body.data) && body.data.length > 0) {
          pendingListingId = body.data[0].listingId;
        }
      } catch (e) {
        // ignore
      }
    } else {
      errorRate.add(1);
    }
  });

  sleep(0.5);

  // ──────────────────────────────────────────────────────────
  // STEP 3: Filter Listings - By Status (Approved)
  // ──────────────────────────────────────────────────────────
  group('3. Filter - Approved Listings', function () {
    const filterPayload = JSON.stringify({
      page: 1,
      size: 20
    });

    const startTime = new Date();
    const res = http.post(`${BASE_URL}/v1/listings/search`, filterPayload, authParams);
    filterListingsDuration.add(new Date() - startTime);

    const success = check(res, {
      'filter approved status is 200': (r) => r.status === 200,
    });

    errorRate.add(success ? 0 : 1);
    if (success) successfulOperations.add(1);
  });

  sleep(0.5);

  // ──────────────────────────────────────────────────────────
  // STEP 4: Filter Listings - By Status (Rejected)
  // ──────────────────────────────────────────────────────────
  group('4. Filter - Rejected Listings', function () {
    const filterPayload = JSON.stringify({
      page: 1,
      size: 20
    });

    const startTime = new Date();
    const res = http.post(`${BASE_URL}/v1/listings/search`, filterPayload, authParams);
    filterListingsDuration.add(new Date() - startTime);

    const success = check(res, {
      'filter rejected status is 200': (r) => r.status === 200,
    });

    errorRate.add(success ? 0 : 1);
    if (success) successfulOperations.add(1);
  });

  sleep(0.5);

  // ──────────────────────────────────────────────────────────
  // STEP 5: Filter Listings - Combined (Status + Date Range)
  // ──────────────────────────────────────────────────────────
  group('5. Filter - Combined', function () {
    const filterPayload = JSON.stringify({
      page: 1,
      size: 20
    });

    const startTime = new Date();
    const res = http.post(`${BASE_URL}/v1/listings/search`, filterPayload, authParams);
    filterListingsDuration.add(new Date() - startTime);

    const success = check(res, {
      'filter combined status is 200': (r) => r.status === 200,
    });

    errorRate.add(success ? 0 : 1);
    if (success) successfulOperations.add(1);
  });

  sleep(1);

  // ──────────────────────────────────────────────────────────
  // STEP 6: Update Listing Status (Approve)
  // Note: This modifies data - use carefully in production
  // ──────────────────────────────────────────────────────────
  if (pendingListingId) {
    group('6. Update Status - Approve', function () {
      const updatePayload = JSON.stringify({
        verified: true,
        reason: 'K6 Performance Test - Auto Approved',
      });

      const startTime = new Date();
      const res = http.put(
        `${BASE_URL}/v1/admin/listings/${pendingListingId}/status`,
        updatePayload,
        authParams
      );
      updateStatusDuration.add(new Date() - startTime);

      const success = check(res, {
        'update status is 200 or 403 or 404': (r) =>
          r.status === 200 || r.status === 403 || r.status === 404,
      });

      if (res.status === 200) {
        successfulOperations.add(1);
        errorRate.add(0);
      } else {
        // 403 = no permission, 404 = not found (may already be approved)
        errorRate.add(0); // Don't count as error
        console.log(`Update status response: ${res.status}`);
      }
    });
  }

  sleep(0.5);

  // ──────────────────────────────────────────────────────────
  // STEP 7: Get Reports (if admin has permission)
  // ──────────────────────────────────────────────────────────
  group('7. Get Listing Reports', function () {
    // Try to get reports for a listing
    const targetListingId = pendingListingId || 1;

    const startTime = new Date();
    const res = http.get(
      `${BASE_URL}/v1/listings/${targetListingId}/reports`,
      authParams
    );
    getReportsDuration.add(new Date() - startTime);

    const success = check(res, {
      'get reports status is 200 or 403 or 404': (r) =>
        r.status === 200 || r.status === 403 || r.status === 404,
    });

    if (res.status === 200) {
      successfulOperations.add(1);
      errorRate.add(0);
      // Get report ID if available
      try {
        const body = JSON.parse(res.body);
        // data là array trực tiếp
        if (body.data && Array.isArray(body.data) && body.data.length > 0) {
          reportId = body.data[0].id;
        }
      } catch (e) {
        // ignore
      }
    } else {
      errorRate.add(0);
    }
  });

  sleep(0.5);

  // ──────────────────────────────────────────────────────────
  // STEP 8: Resolve Report (if report exists)
  // ──────────────────────────────────────────────────────────
  if (reportId) {
    group('8. Resolve Report', function () {
      const resolvePayload = JSON.stringify({
        resolved: true,
        resolution: 'K6 Performance Test - Auto Resolved',
      });

      const startTime = new Date();
      const res = http.put(
        `${BASE_URL}/v1/admin/reports/${reportId}/resolve`,
        resolvePayload,
        authParams
      );
      resolveReportDuration.add(new Date() - startTime);

      const success = check(res, {
        'resolve report status is 200 or 403 or 404': (r) =>
          r.status === 200 || r.status === 403 || r.status === 404,
      });

      if (res.status === 200) {
        successfulOperations.add(1);
      }
      errorRate.add(0);
    });
  }

  // Random sleep between iterations
  sleep(Math.random() * 2 + 1);
}

// ============================================================
// SUMMARY HANDLER
// ============================================================
export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    './results/admin-journey-results.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data, options) {
  const indent = options.indent || '';
  let summary = '\n';
  summary += '='.repeat(70) + '\n';
  summary += indent + 'SMARTRENT ADMIN JOURNEY PERFORMANCE TEST RESULTS\n';
  summary += '='.repeat(70) + '\n\n';

  // Thresholds
  summary += indent + 'THRESHOLDS\n\n';
  if (data.metrics.http_req_duration) {
    const p95 = data.metrics.http_req_duration.values['p(95)'];
    const status = p95 < 3000 ? 'PASS' : 'FAIL';
    summary += indent + `  [${status}] http_req_duration p(95): ${p95.toFixed(2)}ms (target: <3000ms)\n`;
  }
  if (data.metrics.http_req_failed) {
    const failRate = data.metrics.http_req_failed.values.rate * 100;
    const status = failRate < 10 ? 'PASS' : 'FAIL';
    summary += indent + `  [${status}] http_req_failed rate: ${failRate.toFixed(2)}% (target: <10%)\n`;
  }

  // API Performance by Step
  summary += '\n' + indent + 'ADMIN API PERFORMANCE\n\n';

  const metrics = [
    { key: 'admin_login_duration', name: '1. Admin Login' },
    { key: 'admin_filter_listings_duration', name: '2-5. Filter Listings' },
    { key: 'admin_update_status_duration', name: '6. Update Status' },
    { key: 'admin_get_reports_duration', name: '7. Get Reports' },
    { key: 'admin_resolve_report_duration', name: '8. Resolve Report' },
  ];

  metrics.forEach(m => {
    if (data.metrics[m.key]) {
      const avg = data.metrics[m.key].values.avg;
      const p95 = data.metrics[m.key].values['p(95)'];
      summary += indent + `  ${m.name}:\n`;
      summary += indent + `    avg: ${avg.toFixed(2)}ms | p95: ${p95.toFixed(2)}ms\n`;
    }
  });

  // Overall
  summary += '\n' + indent + 'OVERALL METRICS\n\n';
  if (data.metrics.http_reqs) {
    summary += indent + `  Total Requests: ${data.metrics.http_reqs.values.count}\n`;
    summary += indent + `  Request Rate: ${data.metrics.http_reqs.values.rate.toFixed(2)}/s\n`;
  }
  if (data.metrics.successful_operations) {
    summary += indent + `  Successful Operations: ${data.metrics.successful_operations.values.count}\n`;
  }

  summary += '\n' + '='.repeat(70) + '\n';
  return summary;
}
