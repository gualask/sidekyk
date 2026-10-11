import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { followSystemColorScheme } from './app/color-scheme';
import '@fontsource-variable/plus-jakarta-sans';
import './main.css';

followSystemColorScheme();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
