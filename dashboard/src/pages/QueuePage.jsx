import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import StatusBadge from '../components/StatusBadge.jsx';

export default function QueuePage() {
  const { queueId } = useParams();
  const [stats, setStats] = useState({});
  const [jobs, setJobs] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [payload, setPayload] = useState('{"handler":"noop"}');
  const [error, setError] = useState('');
  const [retryPolicies, setRetryPolicies] = useState([]);
  const [queue, setQueue] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', priority: 0, concurrencyLimit: 5, retryPolicyId: '' });
  const [savedMessage, setSavedMessage] = useState('');

  async function load() {
    const [statsRes, jobsRes] = await Promise.all([
      api.queueStats(queueId),
      api.listJobs(queueId, statusFilter ? { status: statusFilter } : {}),
    ]);
    setStats(statsRes.data);
    setJobs(jobsRes.data);
  }

  async function loadQueueConfig() {
    const [queueRes, policiesRes] = await Promise.all([api.getQueue(queueId), api.listRetryPolicies()]);
    setQueue(queueRes.data);
    setRetryPolicies(policiesRes.data);
    setEditForm({
      name: queueRes.data.name,
      priority: queueRes.data.priority,
      concurrencyLimit: queueRes.data.concurrency_limit,
      retryPolicyId: queueRes.data.retry_policy_id || '',
    });
  }

  useEffect(() => { load(); }, [queueId, statusFilter]);
  useEffect(() => { loadQueueConfig(); }, [queueId]);
  // polling 
  useEffect(() => {
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [queueId, statusFilter]);

  async function handlePauseToggle(isPaused) {
    if (isPaused) await api.resumeQueue(queueId);
    else await api.pauseQueue(queueId);
    load();
  }

  async function handleSubmitJob(e) {
    e.preventDefault();
    setError('');
    try {
      const parsed = JSON.parse(payload);
      await api.submitJob(queueId, { type: 'immediate', payload: parsed });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRetry(jobId) {
    await api.retryJob(jobId);
    load();
  }

  async function handleSaveConfig(e) {
    e.preventDefault();
    setError('');
    setSavedMessage('');
    try {
      const { data } = await api.updateQueue(queueId, {
        name: editForm.name,
        priority: Number(editForm.priority),
        concurrencyLimit: Number(editForm.concurrencyLimit),
        retryPolicyId: editForm.retryPolicyId || null,
      });
      setQueue(data);
      setSavedMessage('Saved.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreatePolicy(strategy) {
    const { data } = await api.createRetryPolicy({ strategy, baseDelayMs: 1000, maxAttempts: 5 });
    setRetryPolicies((prev) => [data, ...prev]);
    setEditForm((f) => ({ ...f, retryPolicyId: data.id }));
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Queue: {queue?.name || '...'}</h2>
          <Link to="/">Back to projects</Link>
        </div>
        <div className="grid">
          {Object.entries(stats).map(([status, count]) => (
            <div key={status} className="stat">
              <div className="num">{count}</div>
              <div className="label">{status}</div>
            </div>
          ))}
          {Object.keys(stats).length === 0 && <p className="empty">No jobs yet.</p>}
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="secondary" onClick={() => handlePauseToggle(false)}>Pause queue</button>{' '}
          <button className="secondary" onClick={() => handlePauseToggle(true)}>Resume queue</button>
        </div>
      </div>

      <div className="card">
        <h2>Queue configuration</h2>
        <form onSubmit={handleSaveConfig}>
          <div className="form-row">
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Name</label>
              <input
                style={{ width: '100%' }}
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Priority</label>
              <input
                type="number"
                style={{ width: 90 }}
                value={editForm.priority}
                onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value }))}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Concurrency limit</label>
              <input
                type="number"
                style={{ width: 130 }}
                value={editForm.concurrencyLimit}
                onChange={(e) => setEditForm((f) => ({ ...f, concurrencyLimit: e.target.value }))}
              />
            </div>
          </div>
          <div className="form-row">
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Retry policy</label>
              <select
                style={{ width: '100%' }}
                value={editForm.retryPolicyId}
                onChange={(e) => setEditForm((f) => ({ ...f, retryPolicyId: e.target.value }))}
              >
                <option value="">None (worker default: exponential)</option>
                {retryPolicies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.strategy} — base {p.base_delay_ms}ms, max {p.max_attempts} attempts
                  </option>
                ))}
              </select>
            </div>
            <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 6 }}>
              <button type="button" className="secondary" onClick={() => handleCreatePolicy('fixed')}>+ fixed</button>
              <button type="button" className="secondary" onClick={() => handleCreatePolicy('linear')}>+ linear</button>
              <button type="button" className="secondary" onClick={() => handleCreatePolicy('exponential')}>+ exponential</button>
            </div>
          </div>
          <button type="submit">Save configuration</button>
          {savedMessage && <span style={{ marginLeft: 12, color: '#27500a', fontSize: 13 }}>{savedMessage}</span>}
        </form>
      </div>

      <div className="card">
        <h2>Submit a test job</h2>
        <form onSubmit={handleSubmitJob} className="form-row">
          <input
            style={{ flex: 1 }}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            placeholder='{"handler":"noop"}'
          />
          <button type="submit">Submit immediate job</button>
        </form>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        <h2>Job explorer</h2>
        <div className="form-row">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="queued">Queued</option>
            <option value="claimed">Claimed</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="dead">Dead</option>
          </select>
        </div>
        {jobs.length === 0 ? (
          <p className="empty">No jobs match this filter.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Run at</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td><Link to={`/jobs/${j.id}`}>{j.id.slice(0, 8)}</Link></td>
                  <td>{j.type}</td>
                  <td><StatusBadge status={j.status} /></td>
                  <td>{j.attempt_count}</td>
                  <td>{new Date(j.run_at).toLocaleString()}</td>
                  <td>
                    {(j.status === 'failed' || j.status === 'dead') && (
                      <button className="secondary" onClick={() => handleRetry(j.id)}>Retry</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
