import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ============================================================
// SMARTRENT FULL API PERFORMANCE TEST (Excluding Search API)
// Test all APIs: Auth, Listings, Stats, Save, Create, Push
// ============================================================

// Custom metrics
const errorRate = new Rate('errors');
const loginDuration = new Trend('login_duration');
const listingsDuration = new Trend('get_listings_duration');
const listingDetailDuration = new Trend('listing_detail_duration');
const myListingsDuration = new Trend('my_listings_duration');
const statsProvinceDuration = new Trend('stats_province_duration');
const statsCategoryDuration = new Trend('stats_category_duration');
const saveListingDuration = new Trend('save_listing_duration');
const createListingDuration = new Trend('create_listing_duration');
const pushListingDuration = new Trend('push_listing_duration');
const successfulOperations = new Counter('successful_operations');

// Test configuration
// Server specs: 4GB RAM, 2 core CPU
// Light load test: 5 VUs, ~3-5 req/s
export const options = {
  scenarios: {
    full_api_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 3 },   // Warm up: 3 users
        { duration: '30s', target: 5 },   // Ramp up: 5 users
        { duration: '2m', target: 5 },    // Sustain: 5 users (~3-5 req/s)
        { duration: '20s', target: 0 },   // Ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],    // 95% requests < 2s
    http_req_failed: ['rate<0.05'],       // Error rate < 5%
    errors: ['rate<0.05'],
    login_duration: ['p(95)<2000'],
    get_listings_duration: ['p(95)<2000'],
    listing_detail_duration: ['p(95)<1000'],
    my_listings_duration: ['p(95)<2000'],
    stats_province_duration: ['p(95)<1000'],
    stats_category_duration: ['p(95)<1000'],
    save_listing_duration: ['p(95)<1000'],
    create_listing_duration: ['p(95)<3000'],
    push_listing_duration: ['p(95)<1000'],
  },
};

const BASE_URL = 'https://dev.api.smartrent.io.vn';

// Test credentials
const TEST_USER = {
  email: 'user1@smartrent.vn',
  password: 'Security@123',
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function login() {
  const payload = JSON.stringify({
    email: TEST_USER.email,
    password: TEST_USER.password,
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  const startTime = new Date();
  const res = http.post(`${BASE_URL}/v1/auth`, payload, params);
  loginDuration.add(new Date() - startTime);

  const success = check(res, {
    'login status is 200': (r) => r.status === 200,
    'login has access token': (r) => {
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
    console.log(`Login failed: ${res.status} - ${res.body}`);
    return null;
  }

  errorRate.add(0);
  successfulOperations.add(1);
  const body = JSON.parse(res.body);
  return body.data.accessToken;
}

function getAuthHeaders(token) {
  return {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };
}

function getPublicHeaders() {
  return {
    headers: {
      'Content-Type': 'application/json',
    },
  };
}

// ============================================================
// MAIN TEST FUNCTION
// ============================================================
export default function () {
  let token = null;
  let listingId = null;
  let createdListingId = null;

  // ──────────────────────────────────────────────────────────
  // GROUP 1: Authentication
  // ──────────────────────────────────────────────────────────
  group('1. Authentication', function () {
    token = login();
  });

  if (!token) {
    sleep(1);
    return;
  }

  const authParams = getAuthHeaders(token);
  const publicParams = getPublicHeaders();

  // ──────────────────────────────────────────────────────────
  // GROUP 2: Public APIs - Get Listings
  // ──────────────────────────────────────────────────────────
  group('2. Get Listings (Public)', function () {
    const startTime = new Date();
    const res = http.get(`${BASE_URL}/v1/listings?page=1&size=10`);
    listingsDuration.add(new Date() - startTime);

    const success = check(res, {
      'get listings status is 200': (r) => r.status === 200,
      'get listings has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          // data là array trực tiếp, không phải object.content
          return body.data && Array.isArray(body.data) && body.data.length > 0;
        } catch {
          return false;
        }
      },
      'get listings response time < 2s': (r) => r.timings.duration < 2000,
    });

    if (success) {
      successfulOperations.add(1);
      errorRate.add(0);
      try {
        const body = JSON.parse(res.body);
        // data là array, lấy listingId từ phần tử đầu tiên
        if (body.data && Array.isArray(body.data) && body.data.length > 0) {
          listingId = body.data[0].listingId;
        }
      } catch (e) {
        // ignore
      }
    } else {
      errorRate.add(1);
    }
  });

  sleep(0.3);

  // ──────────────────────────────────────────────────────────
  // GROUP 3: Listing Detail
  // ──────────────────────────────────────────────────────────
  if (listingId) {
    group('3. Listing Detail', function () {
      const startTime = new Date();
      const res = http.get(`${BASE_URL}/v1/listings/${listingId}`);
      listingDetailDuration.add(new Date() - startTime);

      const success = check(res, {
        'listing detail status is 200': (r) => r.status === 200,
        'listing detail has data': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.data && body.data.listingId;
          } catch {
            return false;
          }
        },
        'listing detail response time < 500ms': (r) => r.timings.duration < 500,
      });

      errorRate.add(success ? 0 : 1);
      if (success) successfulOperations.add(1);
    });
  }

  sleep(0.3);

  // ──────────────────────────────────────────────────────────
  // GROUP 4: My Listings (Protected)
  // ──────────────────────────────────────────────────────────
  group('4. My Listings (Protected)', function () {
    const startTime = new Date();
    const res = http.get(`${BASE_URL}/v1/listings?page=1&size=10&mine=true`, authParams);
    myListingsDuration.add(new Date() - startTime);

    const success = check(res, {
      'my listings status is 200': (r) => r.status === 200,
      'my listings has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data !== undefined;
        } catch {
          return false;
        }
      },
      'my listings response time < 2s': (r) => r.timings.duration < 2000,
    });

    errorRate.add(success ? 0 : 1);
    if (success) successfulOperations.add(1);
  });

  sleep(0.3);

  // ──────────────────────────────────────────────────────────
  // GROUP 5: Stats by Province
  // ──────────────────────────────────────────────────────────
  group('5. Stats by Province', function () {
    const startTime = new Date();
    const res = http.post(`${BASE_URL}/v1/listings/stats/provinces`, '{}', publicParams);
    statsProvinceDuration.add(new Date() - startTime);

    const success = check(res, {
      'stats province status is 200': (r) => r.status === 200,
      'stats province has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data !== undefined;
        } catch {
          return false;
        }
      },
      'stats province response time < 1s': (r) => r.timings.duration < 1000,
    });

    errorRate.add(success ? 0 : 1);
    if (success) successfulOperations.add(1);
  });

  sleep(0.3);

  // ──────────────────────────────────────────────────────────
  // GROUP 6: Stats by Category
  // ──────────────────────────────────────────────────────────
  group('6. Stats by Category', function () {
    const startTime = new Date();
    const res = http.post(`${BASE_URL}/v1/listings/stats/categories`, '{}', publicParams);
    statsCategoryDuration.add(new Date() - startTime);

    const success = check(res, {
      'stats category status is 200': (r) => r.status === 200,
      'stats category has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data !== undefined;
        } catch {
          return false;
        }
      },
      'stats category response time < 1s': (r) => r.timings.duration < 1000,
    });

    errorRate.add(success ? 0 : 1);
    if (success) successfulOperations.add(1);
  });

  sleep(0.3);

  // ──────────────────────────────────────────────────────────
  // GROUP 7: Save Listing (Favorite)
  // ──────────────────────────────────────────────────────────
  if (listingId) {
    group('7. Save Listing', function () {
      const payload = JSON.stringify({ listingId: listingId });

      const startTime = new Date();
      const res = http.post(`${BASE_URL}/v1/saved-listings`, payload, authParams);
      saveListingDuration.add(new Date() - startTime);

      const success = check(res, {
        'save listing status is 200/201/409': (r) =>
          r.status === 200 || r.status === 201 || r.status === 409,
        'save listing response time < 1s': (r) => r.timings.duration < 1000,
      });

      errorRate.add(success ? 0 : 1);
      if (success) successfulOperations.add(1);
    });
  }

  sleep(0.3);

  // ──────────────────────────────────────────────────────────
  // GROUP 8: Create Listing
  // ──────────────────────────────────────────────────────────
  group('8. Create Listing', function () {
    const createPayload = JSON.stringify({
      title: `K6 Test Listing ${Date.now()}`,
      description: 'This is a test listing created by K6 performance test. Please ignore.',
      listingType: 'RENT',
      categoryId: 1,
      price: 8000000,
      priceUnit: 'MONTH',
      address: {
        provinceId: 1,
        districtId: 1,
        wardId: 1,
        street: '123 Test Street',
        detail: 'K6 Performance Test',
      },
      area: 50,
      bedrooms: 2,
      bathrooms: 1,
      amenityIds: [1, 2],
      durationDays: 30,
      useMembershipQuota: true,
    });

    const startTime = new Date();
    const res = http.post(`${BASE_URL}/v1/listings`, createPayload, authParams);
    createListingDuration.add(new Date() - startTime);

    const success = check(res, {
      'create listing status is 200/201/400/403': (r) =>
        r.status === 200 || r.status === 201 || r.status === 400 || r.status === 403,
    });

    // 400/403 are expected (no quota, validation, etc.)
    if (res.status === 200 || res.status === 201) {
      successfulOperations.add(1);
      errorRate.add(0);
      try {
        const body = JSON.parse(res.body);
        if (body.data && body.data.id) {
          createdListingId = body.data.id;
        }
      } catch (e) {
        // ignore
      }
    } else {
      // Don't count as error for 400/403
      errorRate.add(0);
    }
  });

  sleep(0.3);

  // ──────────────────────────────────────────────────────────
  // GROUP 9: Push Listing
  // ──────────────────────────────────────────────────────────
  if (createdListingId || listingId) {
    group('9. Push Listing', function () {
      const targetListingId = createdListingId || listingId;
      const pushPayload = JSON.stringify({
        listingId: targetListingId,
        useMembershipQuota: true,
      });

      const startTime = new Date();
      const res = http.post(`${BASE_URL}/v1/pushes/push`, pushPayload, authParams);
      pushListingDuration.add(new Date() - startTime);

      const success = check(res, {
        'push listing status is 200/201/400/403': (r) =>
          r.status === 200 || r.status === 201 || r.status === 400 || r.status === 403,
      });

      // 400/403 are expected (no quota, not owner, etc.)
      if (res.status === 200 || res.status === 201) {
        successfulOperations.add(1);
      }
      errorRate.add(success ? 0 : 1);
    });
  }

  // Random sleep between iterations
  sleep(Math.random() * 0.5 + 0.5);
}

// ============================================================
// SUMMARY HANDLER
// ============================================================
export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    './results/full-api-results.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data, options) {
  const indent = options.indent || '';
  let summary = '\n';
  summary += '='.repeat(70) + '\n';
  summary += indent + 'SMARTRENT FULL API PERFORMANCE TEST RESULTS\n';
  summary += indent + '(Excluding Search API)\n';
  summary += '='.repeat(70) + '\n\n';

  // Thresholds
  summary += indent + '█ THRESHOLDS\n\n';

  const thresholdChecks = [
    { metric: 'http_req_duration', target: 2000, label: 'http_req_duration p(95)' },
    { metric: 'http_req_failed', target: 0.05, label: 'http_req_failed rate', isRate: true },
  ];

  if (data.metrics.http_req_duration) {
    const p95 = data.metrics.http_req_duration.values['p(95)'];
    const status = p95 < 2000 ? '✓ PASS' : '✗ FAIL';
    summary += indent + `  ${status} http_req_duration p(95): ${p95.toFixed(2)}ms (target: <2000ms)\n`;
  }
  if (data.metrics.http_req_failed) {
    const failRate = data.metrics.http_req_failed.values.rate * 100;
    const status = failRate < 5 ? '✓ PASS' : '✗ FAIL';
    summary += indent + `  ${status} http_req_failed rate: ${failRate.toFixed(2)}% (target: <5%)\n`;
  }
  if (data.metrics.errors) {
    const errRate = data.metrics.errors.values.rate * 100;
    const status = errRate < 5 ? '✓ PASS' : '✗ FAIL';
    summary += indent + `  ${status} errors rate: ${errRate.toFixed(2)}% (target: <5%)\n`;
  }

  // API Performance
  summary += '\n' + indent + '█ API PERFORMANCE\n\n';

  const metrics = [
    { key: 'login_duration', name: '1. Login', target: 2000 },
    { key: 'get_listings_duration', name: '2. Get Listings', target: 2000 },
    { key: 'listing_detail_duration', name: '3. Listing Detail', target: 1000 },
    { key: 'my_listings_duration', name: '4. My Listings', target: 2000 },
    { key: 'stats_province_duration', name: '5. Stats Province', target: 1000 },
    { key: 'stats_category_duration', name: '6. Stats Category', target: 1000 },
    { key: 'save_listing_duration', name: '7. Save Listing', target: 1000 },
    { key: 'create_listing_duration', name: '8. Create Listing', target: 3000 },
    { key: 'push_listing_duration', name: '9. Push Listing', target: 1000 },
  ];

  metrics.forEach(m => {
    if (data.metrics[m.key]) {
      const avg = data.metrics[m.key].values.avg;
      const p95 = data.metrics[m.key].values['p(95)'];
      const status = p95 < m.target ? '✓' : '✗';
      summary += indent + `  ${status} ${m.name}:\n`;
      summary += indent + `      avg: ${avg.toFixed(2)}ms | p95: ${p95.toFixed(2)}ms (target: <${m.target}ms)\n`;
    }
  });

  // Overall Metrics
  summary += '\n' + indent + '█ OVERALL METRICS\n\n';
  if (data.metrics.http_reqs) {
    summary += indent + `  Total Requests: ${data.metrics.http_reqs.values.count}\n`;
    summary += indent + `  Request Rate: ${data.metrics.http_reqs.values.rate.toFixed(2)}/s\n`;
  }
  if (data.metrics.iterations) {
    summary += indent + `  Iterations: ${data.metrics.iterations.values.count}\n`;
  }
  if (data.metrics.successful_operations) {
    summary += indent + `  Successful Operations: ${data.metrics.successful_operations.values.count}\n`;
  }
  if (data.metrics.http_req_duration) {
    summary += indent + `  Response Time:\n`;
    summary += indent + `      avg: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms\n`;
    summary += indent + `      min: ${data.metrics.http_req_duration.values.min.toFixed(2)}ms\n`;
    summary += indent + `      max: ${data.metrics.http_req_duration.values.max.toFixed(2)}ms\n`;
    summary += indent + `      p90: ${data.metrics.http_req_duration.values['p(90)'].toFixed(2)}ms\n`;
    summary += indent + `      p95: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms\n`;
  }

  summary += '\n' + '='.repeat(70) + '\n';
  return summary;
}
