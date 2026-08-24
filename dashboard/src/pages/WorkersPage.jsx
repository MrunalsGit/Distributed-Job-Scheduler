import { useEffect, useState } from 'react';
import { api } from '../api/client';

function timeAgo(dateStr) {
  if (!dateStr) return 'never';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState([]);

  async function load() {
    const { data } = await api.listWorkers();
    setWorkers(data);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="card">
      <h2>Workers</h2>
      {workers.length === 0 ? (
        <p className="empty">No workers have registered yet. Start a worker process to see it here.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Max concurrency</th>
              <th>Last heartbeat</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => {
              const stale = !w.last_heartbeat_at ||
                Date.now() - new Date(w.last_heartbeat_at).getTime() > 20000;
              return (
                <tr key={w.id}>
                  <td>{w.id.slice(0, 8)}</td>
                  <td><span className={`badge ${stale ? 'failed' : 'completed'}`}>{stale ? 'stale' : w.status}</span></td>
                  <td>{w.max_concurrency}</td>
                  <td>{timeAgo(w.last_heartbeat_at)}</td>
                  <td>{new Date(w.started_at).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
