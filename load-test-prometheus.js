import http from 'k6/http';
import { check, sleep } from 'k6';

// Test configuration
export const options = {
  stages: [
    { duration: '1m', target: 20 },   // Ramp up to 20 users
    { duration: '3m', target: 20 },   // Stay at 20 users for 3 minutes
    { duration: '1m', target: 0 },    // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // 95% of requests should be below 1000ms
    http_req_failed: ['rate<0.05'],    // Error rate should be less than 5%
  },
};

const BASE_URL = 'https://dev.api.smartrent.io.vn';

export default function () {
  // Test health check endpoint
  const healthRes = http.get(`${BASE_URL}/actuator/health`);

  check(healthRes, {
    'health check status is 200 or 401': (r) => r.status === 200 || r.status === 401,
    'health check response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}
