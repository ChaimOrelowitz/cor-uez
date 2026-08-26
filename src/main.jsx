import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AdminPage from './AdminPage';
import AdminVisitCounter from './AdminVisitCounter';
import BrcLiveTestPage from './BrcLiveTestPage';
import EmailSettingsPage from './EmailSettingsPage';
import AccountRecoveryPage from './AccountRecoveryPage';
import { trackPublicVisit } from './analytics';
import './styles.css';
import './workflow.css';
import './brcLive.css';
import './clientDashboard.css';
import './intakePolish.css';
import './emailSettings.css';
import './analytics.css';

function AdminWithAnalytics() {
  return <><AdminPage /><AdminVisitCounter /></>;
}

const path = window.location.pathname;
let Root;
if (path === '/admin') Root = AdminWithAnalytics;
else if (path === '/admin/email-settings') Root = EmailSettingsPage;
else if (path === '/brc-test') Root = BrcLiveTestPage;
else if (path === '/forgot-password') Root = () => <AccountRecoveryPage mode="forgot" />;
else if (path === '/reset-password') Root = () => <AccountRecoveryPage mode="reset" />;
else {
  Root = App;
  if (path === '/') trackPublicVisit();
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
