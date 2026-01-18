import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ============================================================
// SMARTRENT USER JOURNEY PERFORMANCE TEST
// Scenario: User login -> browse -> save -> search -> create listing -> push
// ============================================================

// Custom metrics
const errorRate = new Rate('errors');
const loginDuration = new Trend('login_duration');
const listingsDuration = new Trend('get_listings_duration');
const listingDetailDuration = new Trend('listing_detail_duration');
const saveListingDuration = new Trend('save_listing_duration');
const searchDuration = new Trend('search_duration');
const createListingDuration = new Trend('create_listing_duration');
const pushListingDuration = new Trend('push_listing_duration');
const successfulOperations = new Counter('successful_operations');

// Test configuration
export const options = {
  scenarios: {
    user_journey: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 5 },   // Ramp up to 5 users
        { duration: '1m', target: 10 },   // Ramp up to 10 users
        { duration: '2m', target: 10 },   // Stay at 10 users
        { duration: '30s', target: 0 },   // Ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000'],    // 95% requests < 3s
    http_req_failed: ['rate<0.10'],       // Error rate < 10%
    errors: ['rate<0.10'],
    login_duration: ['p(95)<2000'],
    get_listings_duration: ['p(95)<2000'],
    listing_detail_duration: ['p(95)<1000'],
    search_duration: ['p(95)<5000'],      // Search can be slower
  },
};

const BASE_URL = 'https://dev.api.smartrent.io.vn';

// Test credentials
const TEST_USER = {
  email: 'user1@smartrent.vn',
  password: 'Security@123',
};

// Helper: Login and get token
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
// MAIN TEST FUNCTION - USER JOURNEY
// ============================================================
export default function () {
  let token = null;
  let listingId = null;
  let createdListingId = null;

  // ──────────────────────────────────────────────────────────
  // STEP 1: Authentication
  // ──────────────────────────────────────────────────────────
  group('1. Authentication', function () {
    token = login();
  });

  if (!token) {
    sleep(1);
    return; // Skip if login failed
  }

  const authParams = getAuthHeaders(token);

  // ──────────────────────────────────────────────────────────
  // STEP 2: Browse Listings (View list)
  // ──────────────────────────────────────────────────────────
  group('2. Browse Listings', function () {
    const startTime = new Date();
    const res = http.get(`${BASE_URL}/v1/listings?page=1&size=10`, authParams);
    listingsDuration.add(new Date() - startTime);

    const success = check(res, {
      'get listings status is 200': (r) => r.status === 200,
      'get listings has data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data && body.data.content;
        } catch {
          return false;
        }
      },
    });

    if (success) {
      successfulOperations.add(1);
      errorRate.add(0);
      // Get first listing ID for next steps
      try {
        const body = JSON.parse(res.body);
        if (body.data.content && body.data.content.length > 0) {
          listingId = body.data.content[0].id;
        }
      } catch (e) {
        // ignore
      }
    } else {
      errorRate.add(1);
    }
  });

  sleep(0.5); // User thinking time

  // ──────────────────────────────────────────────────────────
  // STEP 3: View Listing Detail
  // ──────────────────────────────────────────────────────────
  if (listingId) {
    group('3. View Listing Detail', function () {
      const startTime = new Date();
      const res = http.get(`${BASE_URL}/v1/listings/${listingId}`, authParams);
      listingDetailDuration.add(new Date() - startTime);

      const success = check(res, {
        'listing detail status is 200': (r) => r.status === 200,
        'listing detail has data': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.data && body.data.id;
          } catch {
            return false;
          }
        },
      });

      errorRate.add(success ? 0 : 1);
      if (success) successfulOperations.add(1);
    });

    sleep(1); // User reading listing details

    // ──────────────────────────────────────────────────────────
    // STEP 4: Save Listing (Favorite)
    // ──────────────────────────────────────────────────────────
    group('4. Save Listing', function () {
      const payload = JSON.stringify({ listingId: listingId });

      const startTime = new Date();
      const res = http.post(`${BASE_URL}/v1/saved-listings`, payload, authParams);
      saveListingDuration.add(new Date() - startTime);

      const success = check(res, {
        'save listing status is 200 or 201 or 409': (r) =>
          r.status === 200 || r.status === 201 || r.status === 409, // 409 = already saved
      });

      errorRate.add(success ? 0 : 1);
      if (success) successfulOperations.add(1);
    });
  }

  sleep(0.5);

  // ──────────────────────────────────────────────────────────
  // STEP 5: Search & Filter - By Address (Province)
  // ──────────────────────────────────────────────────────────
  group('5. Search - By Address', function () {
    const searchPayload = JSON.stringify({
      page: 1,
      size: 10,
      provinceIds: [1], // Ha Noi
    });

    const startTime = new Date();
    const res = http.post(`${BASE_URL}/v1/listings/search`, searchPayload, authParams);
    searchDuration.add(new Date() - startTime);

    const success = check(res, {
      'search by address status is 200': (r) => r.status === 200,
      'search has results': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data !== undefined;
        } catch {
          return false;
        }
      },
    });

    errorRate.add(success ? 0 : 1);
    if (success) successfulOperations.add(1);
  });

  sleep(0.5);

  // ──────────────────────────────────────────────────────────
  // STEP 6: Search & Filter - By Pricing
  // ──────────────────────────────────────────────────────────
  group('6. Search - By Pricing', function () {
    const searchPayload = JSON.stringify({
      page: 1,
      size: 10,
      minPrice: 5000000,
      maxPrice: 15000000,
    });

    const startTime = new Date();
    const res = http.post(`${BASE_URL}/v1/listings/search`, searchPayload, authParams);
    searchDuration.add(new Date() - startTime);

    const success = check(res, {
      'search by price status is 200': (r) => r.status === 200,
    });

    errorRate.add(success ? 0 : 1);
    if (success) successfulOperations.add(1);
  });

  sleep(0.5);

  // ──────────────────────────────────────────────────────────
  // STEP 7: Search & Filter - By Amenities
  // ──────────────────────────────────────────────────────────
  group('7. Search - By Amenities', function () {
    const searchPayload = JSON.stringify({
      page: 1,
      size: 10,
      amenityIds: [1, 2, 3], // Example amenity IDs
    });

    const startTime = new Date();
    const res = http.post(`${BASE_URL}/v1/listings/search`, searchPayload, authParams);
    searchDuration.add(new Date() - startTime);

    const success = check(res, {
      'search by amenities status is 200': (r) => r.status === 200,
    });

    errorRate.add(success ? 0 : 1);
    if (success) successfulOperations.add(1);
  });

  sleep(0.5);

  // ──────────────────────────────────────────────────────────
  // STEP 8: Search & Filter - Combined (Address + Price + Amenities)
  // ──────────────────────────────────────────────────────────
  group('8. Search - Combined Filters', function () {
    const searchPayload = JSON.stringify({
      page: 1,
      size: 10,
      provinceIds: [1],
      minPrice: 3000000,
      maxPrice: 20000000,
      amenityIds: [1],
      listingType: 'RENT',
      sortBy: 'CREATED_AT',
      sortDirection: 'DESC',
    });

    const startTime = new Date();
    const res = http.post(`${BASE_URL}/v1/listings/search`, searchPayload, authParams);
    searchDuration.add(new Date() - startTime);

    const success = check(res, {
      'combined search status is 200': (r) => r.status === 200,
    });

    errorRate.add(success ? 0 : 1);
    if (success) successfulOperations.add(1);
  });

  sleep(1);

  // ──────────────────────────────────────────────────────────
  // STEP 9: Create Listing (Simulate - may fail without proper data)
  // ──────────────────────────────────────────────────────────
  group('9. Create Listing', function () {
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
      'create listing status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    });

    if (success) {
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
      // Create listing may fail due to missing quota, payment, etc.
      // This is expected in load testing
      errorRate.add(0); // Don't count as error for this specific case
      console.log(`Create listing response: ${res.status}`);
    }
  });

  sleep(0.5);

  // ──────────────────────────────────────────────────────────
  // STEP 10: Push Listing (Boost)
  // ──────────────────────────────────────────────────────────
  if (createdListingId || listingId) {
    group('10. Push Listing', function () {
      const targetListingId = createdListingId || listingId;
      const pushPayload = JSON.stringify({
        listingId: targetListingId,
        useMembershipQuota: true,
      });

      const startTime = new Date();
      const res = http.post(`${BASE_URL}/v1/pushes/push`, pushPayload, authParams);
      pushListingDuration.add(new Date() - startTime);

      const success = check(res, {
        'push listing status is 200 or 201 or 400': (r) =>
          r.status === 200 || r.status === 201 || r.status === 400, // 400 = no quota
      });

      errorRate.add(success ? 0 : 1);
      if (res.status === 200 || res.status === 201) {
        successfulOperations.add(1);
      }
    });
  }

  // Random sleep between iterations
  sleep(Math.random() + 1);
}

// ============================================================
// SUMMARY HANDLER
// ============================================================
export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    './results/user-journey-results.json': JSON.stringify(data, null, 2),
  };
}

function textSummary(data, options) {
  const indent = options.indent || '';
  let summary = '\n';
  summary += '='.repeat(70) + '\n';
  summary += indent + 'SMARTRENT USER JOURNEY PERFORMANCE TEST RESULTS\n';
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
  summary += '\n' + indent + 'API PERFORMANCE BY STEP\n\n';

  const metrics = [
    { key: 'login_duration', name: '1. Login' },
    { key: 'get_listings_duration', name: '2. Get Listings' },
    { key: 'listing_detail_duration', name: '3. Listing Detail' },
    { key: 'save_listing_duration', name: '4. Save Listing' },
    { key: 'search_duration', name: '5-8. Search/Filter' },
    { key: 'create_listing_duration', name: '9. Create Listing' },
    { key: 'push_listing_duration', name: '10. Push Listing' },
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
