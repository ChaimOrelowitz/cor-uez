import React from 'react';
import ReactDOM from 'react-dom/client';
import ZonePage from './ZonePage';
import EnrollPage from './EnrollPage';
import './base.css';

const enroll = window.location.pathname.match(/^\/enroll\/(.+)$/);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {enroll ? <EnrollPage token={decodeURIComponent(enroll[1])} /> : <ZonePage />}
  </React.StrictMode>
);
