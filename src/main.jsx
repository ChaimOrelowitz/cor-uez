import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AdminPage from './AdminPage';
import BrcLiveTestPage from './BrcLiveTestPage';
import EmailSettingsPage from './EmailSettingsPage';
import AccountRecoveryPage from './AccountRecoveryPage';
import './styles.css';
import './workflow.css';
import './brcLive.css';
import './clientDashboard.css';
import './intakePolish.css';
import './emailSettings.css';

const path = window.location.pathname;
let Root;
if (path === '/admin') Root = AdminPage;
else if (path === '/admin/email-settings') Root = EmailSettingsPage;
else if (path === '/brc-test') Root = BrcLiveTestPage;
else if (path === '/forgot-password') Root = () => <AccountRecoveryPage mode="forgot" />;
else if (path === '/reset-password') Root = () => <AccountRecoveryPage mode="reset" />;
else Root = App;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
