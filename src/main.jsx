import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import BrcLiveTestPage from './BrcLiveTestPage';
import './styles.css';
import './brcLive.css';

const Root = window.location.pathname === '/brc-test' ? BrcLiveTestPage : App;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
