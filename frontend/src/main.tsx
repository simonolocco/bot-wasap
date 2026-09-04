import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './chat-responsive.css';
import './secondary-responsive.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
