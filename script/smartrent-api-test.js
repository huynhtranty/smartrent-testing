import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const loginDuration = new Trend('login_duration');
const listingsDuration = new Trend('get_listings_duration');
const searchDuration = new Trend('search_duration');
const listingDetailDuration = new Trend('listing_detail_duration');

// Test configuration
export const options = {
  stages: [
    { duration: '30s', target: 5 },   // Ramp up to 5 users
    { duration: '1m', target: 10 },   // Ramp up to 10 users
    { duration: '1m', target: 10 },   // Stay at 10 users
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'],  // 95% requests < 5s
    http_req_failed: ['rate<0.10'],     // Error rate < 10%
    errors: ['rate<0.10'],
  },
};

const BASE_URL = 'https://dev.api.smartrent.io.vn';

// Test credentials
const TEST_USER = {
  email: 'user1@smartrent.vn',
  password: 'Security@123',
};

// Helper function to login and get token
function login() {
  const payload = JSON.stringify({
    email: TEST_USER.email,
    password: TEST_USER.password,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
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
  const body = JSON.parse(res.body);
  return body.data.accessToken;
}

// Get auth headers
function getAuthHeaders(token) {
  return {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };
}

export default function () {
  let token = null;

  // Group 1: Authentication
  group('Authentication', function () {
    token = login();
  });

  // Group 2: Public APIs (no auth required)
  group('Public APIs', function () {
    // Test: Get listings (public)
    group('GET /v1/listings', function () {
      const startTime = new Date();
      const res = http.get(`${BASE_URL}/v1/listings?page=1&size=10`);
      listingsDuration.add(new Date() - startTime);

      const success = check(res, {
        'get listings status is 200': (r) => r.status === 200,
        'get listings has data': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.data !== undefined;
          } catch {
            return false;
          }
        },
        'get listings response time < 1s': (r) => r.timings.duration < 1000,
      });

      errorRate.add(success ? 0 : 1);
    });

    // Test: Search listings
    group('POST /v1/listings/search', function () {
      const searchPayload = JSON.stringify({
        page: 1,
        size: 10,
        // Add search filters as needed
      });

      const params = {
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const startTime = new Date();
      const res = http.post(`${BASE_URL}/v1/listings/search`, searchPayload, params);
      searchDuration.add(new Date() - startTime);

      const success = check(res, {
        'search status is 200': (r) => r.status === 200,
        'search has results': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.data !== undefined;
          } catch {
            return false;
          }
        },
        'search response time < 2s': (r) => r.timings.duration < 2000,
      });

      errorRate.add(success ? 0 : 1);
    });

    // Test: Get listing by ID (using a sample ID)
    group('GET /v1/listings/{id}', function () {
      // First get a listing ID from the list
      const listRes = http.get(`${BASE_URL}/v1/listings?page=1&size=1`);

      if (listRes.status === 200) {
        try {
          const listBody = JSON.parse(listRes.body);
          if (listBody.data && listBody.data.content && listBody.data.content.length > 0) {
            const listingId = listBody.data.content[0].id;

            const startTime = new Date();
            const res = http.get(`${BASE_URL}/v1/listings/${listingId}`);
            listingDetailDuration.add(new Date() - startTime);

            const success = check(res, {
              'get listing detail status is 200': (r) => r.status === 200,
              'get listing detail has data': (r) => {
                try {
                  const body = JSON.parse(r.body);
                  return body.data !== undefined;
                } catch {
                  return false;
                }
              },
              'get listing detail response time < 500ms': (r) => r.timings.duration < 500,
            });

            errorRate.add(success ? 0 : 1);
          }
        } catch (e) {
          console.log(`Error parsing listing: ${e}`);
          errorRate.add(1);
        }
      }
    });

    // Test: Get stats by provinces
    group('POST /v1/listings/stats/provinces', function () {
      const params = {
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const res = http.post(`${BASE_URL}/v1/listings/stats/provinces`, '{}', params);

      const success = check(res, {
        'stats provinces status is 200': (r) => r.status === 200,
        'stats provinces response time < 1s': (r) => r.timings.duration < 1000,
      });

      errorRate.add(success ? 0 : 1);
    });

    // Test: Get stats by categories
    group('POST /v1/listings/stats/categories', function () {
      const params = {
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const res = http.post(`${BASE_URL}/v1/listings/stats/categories`, '{}', params);

      const success = check(res, {
        'stats categories status is 200': (r) => r.status === 200,
        'stats categories response time < 1s': (r) => r.timings.duration < 1000,
      });

      errorRate.add(success ? 0 : 1);
    });
  });

  // Group 3: Protected APIs (auth required)
  if (token) {
    group('Protected APIs', function () {
      const authParams = getAuthHeaders(token);

      // Test: Get my listings
      group('GET /v1/listings (my listings)', function () {
        const res = http.get(`${BASE_URL}/v1/listings?page=1&size=10&mine=true`, authParams);

        const success = check(res, {
          'get my listings status is 200': (r) => r.status === 200,
          'get my listings response time < 1s': (r) => r.timings.duration < 1000,
        });

        errorRate.add(success ? 0 : 1);
      });
    });
  }

  // Random sleep between iterations (1-3 seconds)
  sleep(Math.random() * 2 + 1);
}

// Summary handler
export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    './k6-api-test-results.json': JSON.stringify(data, null, 2),
  };
}

// Text summary helper
function textSummary(data, options) {
  const indent = options.indent || '';
  let summary = '\n';
  summary += '='.repeat(60) + '\n';
  summary += indent + 'SMARTRENT API PERFORMANCE TEST RESULTS\n';
  summary += '='.repeat(60) + '\n\n';

  // Thresholds
  summary += indent + '█ THRESHOLDS\n\n';
  if (data.metrics.http_req_duration) {
    const p95 = data.metrics.http_req_duration.values['p(95)'];
    summary += indent + `  http_req_duration p(95): ${p95.toFixed(2)}ms\n`;
  }
  if (data.metrics.http_req_failed) {
    const failRate = data.metrics.http_req_failed.values.rate * 100;
    summary += indent + `  http_req_failed rate: ${failRate.toFixed(2)}%\n`;
  }

  // Custom metrics
  summary += '\n' + indent + '█ CUSTOM METRICS\n\n';

  if (data.metrics.login_duration) {
    summary += indent + `  Login Duration:\n`;
    summary += indent + `    avg: ${data.metrics.login_duration.values.avg.toFixed(2)}ms\n`;
    summary += indent + `    p95: ${data.metrics.login_duration.values['p(95)'].toFixed(2)}ms\n`;
  }

  if (data.metrics.get_listings_duration) {
    summary += indent + `  Get Listings Duration:\n`;
    summary += indent + `    avg: ${data.metrics.get_listings_duration.values.avg.toFixed(2)}ms\n`;
    summary += indent + `    p95: ${data.metrics.get_listings_duration.values['p(95)'].toFixed(2)}ms\n`;
  }

  if (data.metrics.search_duration) {
    summary += indent + `  Search Duration:\n`;
    summary += indent + `    avg: ${data.metrics.search_duration.values.avg.toFixed(2)}ms\n`;
    summary += indent + `    p95: ${data.metrics.search_duration.values['p(95)'].toFixed(2)}ms\n`;
  }

  if (data.metrics.listing_detail_duration) {
    summary += indent + `  Listing Detail Duration:\n`;
    summary += indent + `    avg: ${data.metrics.listing_detail_duration.values.avg.toFixed(2)}ms\n`;
    summary += indent + `    p95: ${data.metrics.listing_detail_duration.values['p(95)'].toFixed(2)}ms\n`;
  }

  // HTTP metrics
  summary += '\n' + indent + '█ HTTP METRICS\n\n';
  if (data.metrics.http_reqs) {
    summary += indent + `  Total Requests: ${data.metrics.http_reqs.values.count}\n`;
    summary += indent + `  Request Rate: ${data.metrics.http_reqs.values.rate.toFixed(2)}/s\n`;
  }
  if (data.metrics.http_req_duration) {
    summary += indent + `  Response Time:\n`;
    summary += indent + `    avg: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms\n`;
    summary += indent + `    min: ${data.metrics.http_req_duration.values.min.toFixed(2)}ms\n`;
    summary += indent + `    max: ${data.metrics.http_req_duration.values.max.toFixed(2)}ms\n`;
    summary += indent + `    p90: ${data.metrics.http_req_duration.values['p(90)'].toFixed(2)}ms\n`;
    summary += indent + `    p95: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms\n`;
  }

  summary += '\n' + '='.repeat(60) + '\n';

  return summary;
}
