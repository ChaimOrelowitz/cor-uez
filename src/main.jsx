import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AdminPage from './AdminPage';
import BrcLiveTestPage from './BrcLiveTestPage';
import './styles.css';
import './workflow.css';
import './brcLive.css';
import './clientDashboard.css';
import './intakePolish.css';
import './intakePolish';

const path = window.location.pathname;
const Root = path === '/admin' ? AdminPage : path === '/brc-test' ? BrcLiveTestPage : App;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
