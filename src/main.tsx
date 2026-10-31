import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { preloadPanels } from './app/panels';
import '@fontsource-variable/plus-jakarta-sans';
import './main.css';

preloadPanels();
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
