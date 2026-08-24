const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

function getToken() {
  return localStorage.getItem('token');
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error?.message || `Request failed with status ${res.status}`);
  }
  return json;
}

export const api = {
  signup: (email, password) => request('/auth/signup', { method: 'POST', body: { email, password } }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),

  listProjects: () => request('/projects'),
  createProject: (name) => request('/projects', { method: 'POST', body: { name } }),

  listQueues: (projectId) => request(`/projects/${projectId}/queues`),
  getQueue: (queueId) => request(`/queues/${queueId}`),
  createQueue: (projectId, body) => request(`/projects/${projectId}/queues`, { method: 'POST', body }),
  updateQueue: (queueId, body) => request(`/queues/${queueId}`, { method: 'PATCH', body }),
  pauseQueue: (queueId) => request(`/queues/${queueId}/pause`, { method: 'POST' }),
  resumeQueue: (queueId) => request(`/queues/${queueId}/resume`, { method: 'POST' }),
  queueStats: (queueId) => request(`/queues/${queueId}/stats`),

  listRetryPolicies: () => request('/retry-policies'),
  createRetryPolicy: (body) => request('/retry-policies', { method: 'POST', body }),

  listJobs: (queueId, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/queues/${queueId}/jobs${qs ? `?${qs}` : ''}`);
  },
  getJob: (jobId) => request(`/jobs/${jobId}`),
  retryJob: (jobId) => request(`/jobs/${jobId}/retry`, { method: 'POST' }),
  submitJob: (queueId, body) => request(`/queues/${queueId}/jobs`, { method: 'POST', body }),

  listWorkers: () => request('/workers'),

  listDlq: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/dlq${qs ? `?${qs}` : ''}`);
  },
  requeueDlq: (id) => request(`/dlq/${id}/requeue`, { method: 'POST' }),

  metricsOverview: () => request('/metrics/overview'),
  metricsThroughput: () => request('/metrics/throughput'),
};
