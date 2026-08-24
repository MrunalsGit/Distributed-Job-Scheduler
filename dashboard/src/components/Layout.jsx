import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Layout({ children }) {
  const { logout } = useAuth();

  return (
    <div className="layout">
      <nav className="sidebar">
        <h1>Job scheduler</h1>
        <NavLink to="/" end>Projects</NavLink>
        <NavLink to="/workers">Workers</NavLink>
        <NavLink to="/dlq">Dead letter queue</NavLink>
        <NavLink to="/metrics">Metrics</NavLink>
        <a href="#" onClick={(e) => { e.preventDefault(); logout(); }}>Log out</a>
      </nav>
      <main className="content">{children}</main>
    </div>
  );
}
