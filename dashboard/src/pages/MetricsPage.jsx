import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function MetricsPage() {
  const [overview, setOverview] = useState(null);
  const [throughput, setThroughput] = useState([]);

  async function load() {
    const [o, t] = await Promise.all([api.metricsOverview(), api.metricsThroughput()]);
    setOverview(o.data);
    setThroughput(t.data);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const maxCompleted = Math.max(1, ...throughput.map((t) => t.completed));

  return (
    <div>
      <div className="card">
        <h2>System health</h2>
        {overview && (
          <div className="grid">
            {Object.entries(overview.jobsByStatus).map(([status, count]) => (
              <div key={status} className="stat">
                <div className="num">{count}</div>
                <div className="label">{status} jobs</div>
              </div>
            ))}
            <div className="stat">
              <div className="num">{overview.deadLetterCount}</div>
              <div className="label">in DLQ</div>
            </div>
            {Object.entries(overview.workersByStatus).map(([status, count]) => (
              <div key={status} className="stat">
                <div className="num">{count}</div>
                <div className="label">workers {status}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Throughput (completed jobs per minute, last hour)</h2>
        {throughput.length === 0 ? (
          <p className="empty">No completed jobs in the last hour yet.</p>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
            {throughput.map((t) => (
              <div
                key={t.minute}
                title={`${new Date(t.minute).toLocaleTimeString()}: ${t.completed}`}
                style={{
                  flex: 1,
                  background: '#378add',
                  height: `${(t.completed / maxCompleted) * 100}%`,
                  minHeight: 2,
                  borderRadius: '2px 2px 0 0',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
