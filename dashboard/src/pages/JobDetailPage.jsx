import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import StatusBadge from '../components/StatusBadge.jsx';

export default function JobDetailPage() {
  const { jobId } = useParams();
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const { data } = await api.getJob(jobId);
      setJob(data);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [jobId]);
  // Poll while the job might still be in flight — cheap no-op once it's
  // settled since nothing changes, but keeps the view live during a demo.
  useEffect(() => {
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [jobId]);

  async function handleRetry() {
    await api.retryJob(jobId);
    load();
  }

  if (error) return <div className="card"><p className="error">{error}</p></div>;
  if (!job) return <div className="card"><p className="empty">Loading...</p></div>;

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Job {job.id.slice(0, 8)}</h2>
          <Link to={`/queues/${job.queue_id}`}>Back to queue</Link>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 8 }}>
          <div className="stat"><div className="num"><StatusBadge status={job.status} /></div><div className="label">Status</div></div>
          <div className="stat"><div className="num">{job.type}</div><div className="label">Type</div></div>
          <div className="stat"><div className="num">{job.attempt_count}</div><div className="label">Attempts</div></div>
          <div className="stat"><div className="num">{job.priority}</div><div className="label">Priority</div></div>
        </div>
        <p style={{ fontSize: 13, color: '#666', marginTop: 12 }}>
          Run at: {new Date(job.run_at).toLocaleString()}
          {job.claimed_at && <> · Claimed: {new Date(job.claimed_at).toLocaleString()}</>}
          {job.finished_at && <> · Finished: {new Date(job.finished_at).toLocaleString()}</>}
        </p>
        <pre style={{ background: '#f7f7f5', padding: 12, borderRadius: 6, fontSize: 13, overflowX: 'auto' }}>
          {JSON.stringify(job.payload, null, 2)}
        </pre>
        {(job.status === 'failed' || job.status === 'dead') && (
          <button onClick={handleRetry}>Retry this job</button>
        )}
      </div>

      <div className="card">
        <h2>Execution history</h2>
        {job.executions.length === 0 ? (
          <p className="empty">No executions recorded yet — the job hasn't been claimed or run.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Attempt</th>
                <th>Worker</th>
                <th>Status</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {job.executions.map((e) => (
                <tr key={e.id}>
                  <td>{e.attempt_number}</td>
                  <td>{e.worker_id ? e.worker_id.slice(0, 8) : '—'}</td>
                  <td><StatusBadge status={e.status} /></td>
                  <td>{new Date(e.started_at).toLocaleString()}</td>
                  <td>{e.finished_at ? new Date(e.finished_at).toLocaleString() : '—'}</td>
                  <td style={{ color: '#791f1f' }}>{e.error_message || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Logs</h2>
        {job.logs.length === 0 ? (
          <p className="empty">No log entries yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Message</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {job.logs.map((l) => (
                <tr key={l.id}>
                  <td>{l.event_type}</td>
                  <td>{l.message || ''}</td>
                  <td>{new Date(l.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
