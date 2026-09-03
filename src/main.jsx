import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AdminPage from './AdminPage';
import AdminVisitCounter from './AdminVisitCounter';
import EmailSettingsPage from './EmailSettingsPage';
import AccountRecoveryPage from './AccountRecoveryPage';
import SignupLayoutPage from './SignupLayoutPage';
import AccountsPage from './AccountsPage';
import { trackPublicVisit } from './analytics';
import './styles.css';
import './workflow.css';
import './clientDashboard.css';
import './intakePolish.css';
import './emailSettings.css';
import './analytics.css';
import './admin/adminTheme.css';

function AdminWithAnalytics() {
  return <><AdminPage /><AdminVisitCounter /></>;
}

const path = window.location.pathname;
let Root;
if (path === '/admin') Root = AdminWithAnalytics;
else if (path === '/admin/demo-client') Root = () => <App demoMode />;
else if (path === '/admin/signup-layout') Root = SignupLayoutPage;
else if (path === '/admin/email-settings') Root = EmailSettingsPage;
else if (path === '/admin/accounts') Root = AccountsPage;
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
