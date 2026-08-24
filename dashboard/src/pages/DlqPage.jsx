import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function DlqPage() {
  const [entries, setEntries] = useState([]);

  async function load() {
    const { data } = await api.listDlq();
    setEntries(data);
  }

  useEffect(() => { load(); }, []);

  async function handleRequeue(id) {
    await api.requeueDlq(id);
    load();
  }

  return (
    <div className="card">
      <h2>Dead letter queue</h2>
      {entries.length === 0 ? (
        <p className="empty">Nothing here — no jobs have exhausted their retries.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Reason</th>
              <th>Failed at</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{e.job_id.slice(0, 8)}</td>
                <td>{e.reason}</td>
                <td>{new Date(e.failed_at).toLocaleString()}</td>
                <td><button className="secondary" onClick={() => handleRequeue(e.id)}>Requeue</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
