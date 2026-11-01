import { createRoot } from 'react-dom/client';
import App from './app/App.tsx';
import './style.css';
import './workspace-toolbar.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');
createRoot(root).render(<App />);
