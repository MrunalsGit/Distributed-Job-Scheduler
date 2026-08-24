import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [queues, setQueues] = useState([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [newQueueName, setNewQueueName] = useState('');
  const [error, setError] = useState('');

  async function loadProjects() {
    const { data } = await api.listProjects();
    setProjects(data);
    if (data.length && !selectedProject) setSelectedProject(data[0]);
  }

  async function loadQueues(projectId) {
    const { data } = await api.listQueues(projectId);
    setQueues(data);
  }

  useEffect(() => { loadProjects(); }, []);
  useEffect(() => { if (selectedProject) loadQueues(selectedProject.id); }, [selectedProject]);

  async function handleCreateProject(e) {
    e.preventDefault();
    setError('');
    try {
      const { data } = await api.createProject(newProjectName);
      setNewProjectName('');
      setProjects((prev) => [data, ...prev]);
      setSelectedProject(data);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateQueue(e) {
    e.preventDefault();
    setError('');
    try {
      const { data } = await api.createQueue(selectedProject.id, { name: newQueueName });
      setNewQueueName('');
      setQueues((prev) => [...prev, data]);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Projects</h2>
        <form onSubmit={handleCreateProject} className="form-row">
          <input
            placeholder="New project name"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            required
          />
          <button type="submit">Create</button>
        </form>
        {projects.length === 0 && <p className="empty">No projects yet — create one above.</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {projects.map((p) => (
            <button
              key={p.id}
              className={selectedProject?.id === p.id ? '' : 'secondary'}
              onClick={() => setSelectedProject(p)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {selectedProject && (
        <div className="card">
          <h2>Queues in {selectedProject.name}</h2>
          <form onSubmit={handleCreateQueue} className="form-row">
            <input
              placeholder="New queue name"
              value={newQueueName}
              onChange={(e) => setNewQueueName(e.target.value)}
              required
            />
            <button type="submit">Create queue</button>
          </form>

          {queues.length === 0 ? (
            <p className="empty">No queues yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Priority</th>
                  <th>Concurrency</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {queues.map((q) => (
                  <tr key={q.id}>
                    <td>{q.name}</td>
                    <td>{q.priority}</td>
                    <td>{q.concurrency_limit}</td>
                    <td>{q.is_paused ? 'Paused' : 'Active'}</td>
                    <td><Link to={`/queues/${q.id}`}>View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {error && <div className="error">{error}</div>}
    </div>
  );
}
