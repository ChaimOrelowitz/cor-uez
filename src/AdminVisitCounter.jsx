import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAdminVisitStats } from './analytics';

export default function AdminVisitCounter() {
  const [host, setHost] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const locateHost = () => setHost(document.querySelector('.admin-sidebar-head'));
    locateHost();
    const observer = new MutationObserver(locateHost);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!host) return undefined;
    let active = true;

    const load = async () => {
      try {
        const data = await getAdminVisitStats();
        if (active && data) setStats(data);
      } catch (_) {
        // Keep analytics unobtrusive if the admin session is not ready yet.
      }
    };

    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [host]);

  if (!host || !stats) return null;

  return createPortal(
    <div className="admin-visit-counter" title={`Last 30 days: ${stats.last30Days}`}>
      <div><span>Today</span><strong>{stats.today}</strong></div>
      <div><span>7 days</span><strong>{stats.last7Days}</strong></div>
      <div><span>30 days</span><strong>{stats.last30Days}</strong></div>
      <div><span>Total</span><strong>{stats.total}</strong></div>
    </div>,
    host
  );
}
