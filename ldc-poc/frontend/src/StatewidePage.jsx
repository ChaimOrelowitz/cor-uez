import React, { useEffect, useMemo, useRef, useState } from 'react';
import { zoneApi } from './zoneApi';
import './statewide.css';

// "All zones": what's happening in every UEZ zone, from the state portal's statewide reports
// (weekly Application Processing, monthly Investment & Employment and industry profiles,
// current tax-delinquency and incomplete-application lists). Your zone is always highlighted.

const DAY = 864e5;
function title(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s\-/&(.,#])([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/\bLlc\b/g, 'LLC').replace(/\bInc\b/g, 'Inc');
}
const isoAdd = (iso, days) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);
function fmtDay(iso) { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return new Date(Date.UTC(+y, +m - 1, +d, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtShort(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return new Date(Date.UTC(+y, +m - 1, +d, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtMonth(iso) { if (!iso) return '—'; const [y, m] = iso.split('-'); return new Date(Date.UTC(+y, +m - 1, 1, 12)).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); }
const num = (n) => (n == null ? '—' : Number(n).toLocaleString());
function money(n) {
  if (n == null) return '—';
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(0)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : String(a);
  return `${n < 0 ? '−' : ''}$${s}`;
}
function delta(n, fmt = num) {
  if (n == null) return null;
  if (n === 0) return <span className="sw-delta">no change</span>;
  return <span className="sw-delta">{n > 0 ? '▲' : '▼'} {fmt(Math.abs(n))}</span>;
}
function rankOf(list, key, zone) {
  const sorted = [...list].filter((z) => z[key] != null).sort((a, b) => b[key] - a[key]);
  const i = sorted.findIndex((z) => z.zone === zone);
  return i === -1 ? null : { rank: i + 1, of: sorted.length };
}

const PERIODS = [
  ['week', 'Last week'], ['4w', '4 weeks'], ['13w', '3 months'], ['ytd', 'This year'], ['52w', '12 months'], ['ly', 'Last year']
];
function periodRange(key, lastWeek) {
  const y = Number(lastWeek.slice(0, 4));
  if (key === 'week') return [lastWeek, lastWeek];
  if (key === '4w') return [isoAdd(lastWeek, -21), lastWeek];
  if (key === '13w') return [isoAdd(lastWeek, -84), lastWeek];
  if (key === 'ytd') return [`${y}-01-01`, lastWeek];
  if (key === '52w') return [isoAdd(lastWeek, -357), lastWeek];
  return [`${y - 1}-01-01`, `${y - 1}-12-31`];
}

const METRICS = [
  ['cert', 'New businesses', 'New UEZ certifications approved'],
  ['net', 'Net growth', 'New businesses minus inactivations'],
  ['annual', 'Annual reports', 'Annual reporting forms processed'],
  ['recert', 'Recertifications', 'Recertification applications processed'],
  ['inactivated', 'Inactivated', 'Businesses dropped from the program'],
  ['total', 'All activity', 'Everything the state processed']
];

// Industry groups: the five biggest sectors statewide, everything else folded into "Other".
const SECTOR_LABEL = { agriculture: 'Agriculture', mining: 'Mining', construction: 'Construction', manufacturing: 'Manufacturing', transport: 'Transportation', wholesale: 'Wholesale', retail: 'Retail', finance: 'Finance & real estate', services: 'Services', public_admin: 'Public admin', nonclass: 'Unclassified' };
const SECTOR_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#9aa3b2'];

// ---------- charts (plain SVG) ----------
function useWidth() {
  const ref = useRef(null); const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
function niceMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

// Line chart with crosshair + tooltip. series: [{ key, label, color, values: number[] }], labels: x labels.
function LineChart({ labels, series, height = 210, yFmt = num, xFmt = (l) => l }) {
  const [ref, w] = useWidth(); const [hover, setHover] = useState(null);
  const pad = { l: 44, r: 92, t: 12, b: 26 };
  const n = labels.length; const ih = height - pad.t - pad.b; const iw = w - pad.l - pad.r;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 80))));
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - pad.l) / iw) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };
  return (
    <div ref={ref} className="sw-chart">
      <svg width={w} height={height} role="img" aria-label={series.map((s) => s.label).join(' vs ')} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => <g key={t}><line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="sw-grid" /><text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="sw-axis">{yFmt(t)}</text></g>)}
        {labels.map((l, i) => (i % every === 0 || i === n - 1) && <text key={l} x={x(i)} y={height - 8} textAnchor="middle" className="sw-axis">{xFmt(l)}</text>)}
        {series.map((s) => (
          <g key={s.key}>
            <polyline fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
            {n > 0 && <text x={x(n - 1) + 8} y={y(s.values[n - 1]) + 4} className="sw-direct">{s.label}</text>}
          </g>
        ))}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="sw-cross" />
            {series.map((s) => <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r="4.5" fill={s.color} stroke="#fff" strokeWidth="2" />)}
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="sw-tip" style={{ left: Math.min(x(hover) + 12, w - 170), top: 8 }}>
          <div className="sw-tip-h">{xFmt(labels[hover], true)}</div>
          {series.map((s) => <div key={s.key} className="sw-tip-r"><i style={{ background: s.color }} />{s.label}<b>{yFmt(s.values[hover])}</b></div>)}
        </div>
      )}
    </div>
  );
}

// Column chart for one series with per-bar hover.
function Columns({ labels, values, color = 'var(--blue)', height = 150, yFmt = num, xFmt = (l) => l }) {
  const [ref, w] = useWidth(); const [hover, setHover] = useState(null);
  const pad = { l: 34, r: 8, t: 10, b: 24 };
  const n = labels.length; const iw = w - pad.l - pad.r; const ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...values)); const slot = iw / Math.max(1, n); const bw = Math.max(2, slot - 2);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 70))));
  return (
    <div ref={ref} className="sw-chart">
      <svg width={w} height={height} role="img" aria-label="weekly chart" onMouseLeave={() => setHover(null)}>
        {[0, max].map((t) => <g key={t}><line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="sw-grid" /><text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="sw-axis">{yFmt(t)}</text></g>)}
        {values.map((v, i) => {
          const h = Math.max(v > 0 ? 2 : 0, pad.t + ih - y(v)); const bx = pad.l + i * slot + 1; const r = Math.min(4, bw / 2, h);
          return (
            <g key={labels[i]} onMouseEnter={() => setHover(i)}>
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={ih} fill="transparent" />
              {h > 0 && <path d={`M${bx},${pad.t + ih} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z`} fill={color} opacity={hover == null || hover === i ? 1 : 0.55} />}
            </g>
          );
        })}
        {labels.map((l, i) => i % every === 0 && <text key={l} x={pad.l + i * slot + slot / 2} y={height - 7} textAnchor="middle" className="sw-axis">{xFmt(l)}</text>)}
      </svg>
      {hover != null && (
        <div className="sw-tip" style={{ left: Math.min(pad.l + hover * slot + slot, w - 150), top: 4 }}>
          <div className="sw-tip-h">{xFmt(labels[hover], true)}</div>
          <div className="sw-tip-r"><b>{yFmt(values[hover])}</b></div>
        </div>
      )}
    </div>
  );
}

// ---------- page ----------
export default function StatewidePage({ org, onViewBusinesses }) {
  const [period, setPeriod] = useState('ytd');
  const [tab, setTab] = useState('leaderboard');
  const [data, setData] = useState(null); const [err, setErr] = useState('');
  const [lastWeek, setLastWeek] = useState(null);
  const [profile, setProfile] = useState(null);
  const me = org.zone_name;

  useEffect(() => { zoneApi.stateOverview(org.id).then((d) => { setLastWeek(d.coverage.last_week); if (!d.coverage.last_week) setData(d); }).catch((e) => setErr(e.message)); }, [org.id]);
  useEffect(() => {
    if (!lastWeek) return;
    const [from, to] = periodRange(period, lastWeek);
    setData(null);
    zoneApi.stateOverview(org.id, from, to).then(setData).catch((e) => setErr(e.message));
  }, [org.id, period, lastWeek]);

  if (err) return <div className="z-alert bad">{err}</div>;
  if (!data) return <div className="z-card z-muted" style={{ padding: 20 }}>Loading all zones…</div>;
  if (!data.coverage.last_week) {
    return (
      <div className="z-card z-pad">
        <h2 className="z-h2">Statewide data is on its way</h2>
        <p className="z-sub">EZMinder is loading every zone's history from the state portal's statewide reports. The first load runs in the background; this page fills in as it goes.</p>
      </div>
    );
  }
  const mine = data.zones.find((z) => z.zone === me) || {};
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  return (
    <div className="sw">
      <div className="sw-head">
        <div className="z-seg" role="tablist" aria-label="Time period">
          {PERIODS.map(([k, l]) => <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>)}
        </div>
        <div className="z-muted small">{fmtDay(data.range.from)} – {fmtDay(data.range.to)} · state processing through {fmtDay(data.coverage.last_week)}</div>
      </div>

      <div className="z-stats">
        <Standing label="New businesses" value={num(mine.cert)} rank={rankOf(data.zones, 'cert', me)} note={<>{pct(mine.cert, data.totals.cert)}% of all {num(data.totals.cert)} statewide {delta(mine.cert - mine.prev?.cert)}</>} />
        <Standing label="Net growth" value={`${mine.net > 0 ? '+' : ''}${num(mine.net)}`} rank={rankOf(data.zones, 'net', me)} note={<>{num(mine.cert)} joined · {num(mine.inactivated)} dropped</>} />
        <Standing label="Active businesses" value={num(mine.active_businesses)} rank={rankOf(data.zones, 'active_businesses', me)} note={<>as of {fmtMonth(data.latest_month)} {mine.active_yoy != null && <>· {mine.active_yoy >= 0 ? '+' : ''}{num(mine.active_yoy)} in a year</>}</>} />
        <Standing label="Full-time jobs" value={num(mine.ft_jobs)} rank={rankOf(data.zones, 'ft_jobs', me)} note={<>at certified businesses {mine.ft_yoy != null && <>· {mine.ft_yoy >= 0 ? '+' : ''}{num(mine.ft_yoy)} in a year</>}</>} />
      </div>

      <div className="z-seg sw-tabs" role="tablist" aria-label="View">
        {[['leaderboard', 'Leaderboard'], ['feed', 'Across NJ'], ['growth', 'Growth & jobs'], ['industry', 'Industries'], ['compliance', 'Compliance']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'leaderboard' && <Leaderboard data={data} me={me} onPick={setProfile} />}
      {tab === 'feed' && <Feed org={org} me={me} onPick={setProfile} />}
      {tab === 'growth' && <Growth data={data} me={me} onPick={setProfile} />}
      {tab === 'industry' && <Industries data={data} me={me} onPick={setProfile} />}
      {tab === 'compliance' && <Compliance data={data} me={me} onPick={setProfile} />}

      {profile && <ZoneProfile org={org} zone={profile} me={me} overview={data} onClose={() => setProfile(null)} onViewBusinesses={onViewBusinesses} />}
    </div>
  );
}

function Standing({ label, value, rank, note }) {
  return (
    <div className="z-stat sw-standing">
      <div className="k">{label}{rank && <span className={`sw-rank ${rank.rank <= 3 ? 'top' : ''}`}>#{rank.rank} of {rank.of}</span>}</div>
      <div className="v">{value}</div>
      <div className="m">{note}</div>
    </div>
  );
}

function SortTh({ k, label, sort, setSort, className }) {
  const on = sort.key === k;
  return <th className={`sw-sortable ${className || ''}`} onClick={() => setSort({ key: k, dir: on && sort.dir === 'desc' ? 'asc' : 'desc' })} aria-sort={on ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}>{label}{on ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}</th>;
}
function sortRows(rows, { key, dir }) {
  return [...rows].sort((a, b) => { const x = a[key]; const y = b[key]; if (x == null) return 1; if (y == null) return -1; return dir === 'desc' ? y - x : x - y; });
}
function ZoneCell({ z, me }) {
  return <td><strong>{title(z.zone)}</strong>{z.zone === me && <span className="sw-you">You</span>}</td>;
}

// ---------- Leaderboard ----------
function Leaderboard({ data, me, onPick }) {
  const [metric, setMetric] = useState('cert');
  const rows = useMemo(() => [...data.zones].sort((a, b) => b[metric] - a[metric]), [data, metric]);
  const max = Math.max(1, ...rows.map((z) => Math.abs(z[metric])));
  const info = METRICS.find((m) => m[0] === metric);
  const trendLabels = data.trend.map((t) => t.period);
  const fmtX = (p, long) => (data.bucket === 'month' ? fmtMonth(p) : long ? `Week of ${fmtDay(p)}` : fmtShort(p));
  return (
    <>
      {data.trend.length > 1 && (
        <div className="z-card z-pad sw-section">
          <h2 className="z-h2">New businesses per {data.bucket}: {title(me)} vs. the average zone</h2>
          <LineChart labels={trendLabels} xFmt={fmtX} yFmt={(v) => (v % 1 ? v.toFixed(1) : num(v))} series={[
            { key: 'mine', label: title(me), color: 'var(--blue)', values: data.trend.map((t) => t.mine) },
            { key: 'avg', label: 'Avg zone', color: '#8b94a4', values: data.trend.map((t) => Math.round(t.avg * 10) / 10) }
          ]} />
        </div>
      )}
      <div className="z-card sw-section">
        <div className="z-pad sw-board-head">
          <div><h2 className="z-h2">Zone leaderboard</h2><div className="z-muted small">{info[2]} · click a zone for its full profile</div></div>
          <select className="sw-select" value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Rank by">
            {METRICS.map(([k, l]) => <option key={k} value={k}>Rank by: {l}</option>)}
          </select>
        </div>
        <div className="z-table-wrap">
          <table className="z-table sw-board">
            <thead><tr><th className="sw-num">#</th><th>Zone</th><th>{info[1]}</th><th className="z-hide-sm">vs. prior period</th><th className="z-hide-sm sw-num">New</th><th className="z-hide-sm sw-num">Annual</th><th className="z-hide-sm sw-num">Recert</th><th className="z-hide-sm sw-num">Dropped</th></tr></thead>
            <tbody>
              {rows.map((z, i) => (
                <tr key={z.zone} className={z.zone === me ? 'z-mine' : ''} onClick={() => onPick(z.zone)}>
                  <td className="sw-num sw-rankcell">{i + 1}</td>
                  <ZoneCell z={z} me={me} />
                  <td className="sw-barcell">
                    <div className="sw-hbar"><i className={z.zone === me ? 'me' : ''} style={{ width: `${(Math.max(0, z[metric]) / max) * 100}%` }} /></div>
                    <span className="sw-val">{metric === 'net' && z.net > 0 ? '+' : ''}{num(z[metric])}</span>
                  </td>
                  <td className="z-hide-sm">{delta(z[metric] - z.prev[metric])}</td>
                  <td className="z-hide-sm sw-num">{num(z.cert)}</td>
                  <td className="z-hide-sm sw-num">{num(z.annual)}</td>
                  <td className="z-hide-sm sw-num">{num(z.recert)}</td>
                  <td className="z-hide-sm sw-num">{num(z.inactivated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="z-pad z-muted small">Prior period: {fmtDay(data.prev.from)} – {fmtDay(data.prev.to)}. Source: NJ UEZ Application Processing Summary (state portal).</div>
      </div>
    </>
  );
}

// ---------- Across NJ (who joined / left, by zone) ----------
const KIND_LABEL = { certified: 'Joined', inactivated: 'Dropped', annual: 'Annual report', recertified: 'Recertified' };
function Feed({ org, me, onPick }) {
  const [weeks, setWeeks] = useState(1); const [data, setData] = useState(null); const [q, setQ] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { setData(null); zoneApi.stateFeed(org.id, weeks).then(setData).catch((e) => setErr(e.message)); }, [org.id, weeks]);
  const groups = useMemo(() => {
    if (!data) return [];
    const n = q.trim().toLowerCase();
    const m = new Map();
    for (const r of data.rows) {
      if (n && !`${r.name} ${r.zone_name}`.toLowerCase().includes(n)) continue;
      if (!m.has(r.zone_name)) m.set(r.zone_name, { zone: r.zone_name, certified: [], inactivated: [], annual: [], recertified: [] });
      m.get(r.zone_name)[r.kind]?.push(r);
    }
    return [...m.values()].sort((a, b) => (a.zone === me ? -1 : b.zone === me ? 1 : b.certified.length - a.certified.length || a.zone.localeCompare(b.zone)));
  }, [data, q, me]);
  if (err) return <div className="z-alert bad">{err}</div>;
  return (
    <div className="sw-section">
      <div className="z-toolbar">
        <div className="z-seg">{[[1, 'Last week'], [4, 'Last 4 weeks'], [8, 'Last 8 weeks']].map(([w, l]) => <button key={w} className={weeks === w ? 'on' : ''} onClick={() => setWeeks(w)}>{l}</button>)}</div>
        <input className="z-search sw-search" placeholder="Search businesses or zones…" value={q} onChange={(e) => setQ(e.target.value)} />
        {data && <span className="z-muted small">State processing {fmtDay(data.from)} – {fmtDay(data.to)}</span>}
      </div>
      {!data ? <div className="z-card z-muted" style={{ padding: 20 }}>Loading…</div> : (
        <div className="sw-feed">
          {groups.map((g) => (
            <div key={g.zone} className={`z-card sw-feed-card ${g.zone === me ? 'mine' : ''}`}>
              <button className="sw-feed-zone" onClick={() => onPick(g.zone)}>{title(g.zone)}{g.zone === me && <span className="sw-you">You</span>}<span className="sw-feed-go">Profile →</span></button>
              <div className="sw-feed-counts">
                <span><b>{g.certified.length}</b> joined</span><span><b>{g.inactivated.length}</b> dropped</span>
                <span><b>{g.annual.length}</b> annual reports</span><span><b>{g.recertified.length}</b> recertified</span>
              </div>
              {['certified', 'inactivated'].map((k) => g[k].length > 0 && (
                <div key={k} className="sw-feed-list">
                  <div className="sw-feed-k">{KIND_LABEL[k]}</div>
                  <ul>{g[k].slice(0, 12).map((r) => <li key={`${r.file_no}${r.week_ending}`}>{title(r.name)}{weeks > 1 && <span className="z-muted small"> · {fmtShort(r.week_ending)}</span>}</li>)}</ul>
                  {g[k].length > 12 && <div className="z-muted small">+{g[k].length - 12} more</div>}
                </div>
              ))}
            </div>
          ))}
          {!groups.length && <div className="z-card z-muted" style={{ padding: 20 }}>Nothing matches.</div>}
        </div>
      )}
    </div>
  );
}

// ---------- Growth & jobs (monthly Investment & Employment snapshot) ----------
function Growth({ data, me, onPick }) {
  const [sort, setSort] = useState({ key: 'active_businesses', dir: 'desc' });
  const rows = sortRows(data.zones.filter((z) => z.active_businesses != null), sort);
  const p = { sort, setSort };
  return (
    <div className="z-card sw-section">
      <div className="z-pad"><h2 className="z-h2">Growth &amp; jobs</h2><div className="z-muted small">State Investment &amp; Employment Summary for {fmtMonth(data.latest_month)}, compared with 12 months earlier. Click a column to sort.</div></div>
      <div className="z-table-wrap">
        <table className="z-table">
          <thead><tr><th>Zone</th><SortTh k="active_businesses" label="Active businesses" {...p} /><SortTh k="active_yoy" label="1-yr change" {...p} /><SortTh k="ft_jobs" label="Full-time jobs" {...p} /><SortTh k="ft_yoy" label="1-yr change" className="z-hide-sm" {...p} /><SortTh k="new_ft_jobs" label="New FT jobs*" className="z-hide-sm" {...p} /><SortTh k="invest_total" label="Private investment*" className="z-hide-sm" {...p} /></tr></thead>
          <tbody>
            {rows.map((z) => (
              <tr key={z.zone} className={z.zone === me ? 'z-mine' : ''} onClick={() => onPick(z.zone)}>
                <ZoneCell z={z} me={me} />
                <td className="sw-num">{num(z.active_businesses)}</td>
                <td className="sw-num">{z.active_yoy == null ? '—' : `${z.active_yoy > 0 ? '+' : ''}${num(z.active_yoy)}`}</td>
                <td className="sw-num">{num(z.ft_jobs)}</td>
                <td className="sw-num z-hide-sm">{z.ft_yoy == null ? '—' : `${z.ft_yoy > 0 ? '+' : ''}${num(z.ft_yoy)}`}</td>
                <td className="sw-num z-hide-sm">{num(z.new_ft_jobs)}</td>
                <td className="sw-num z-hide-sm">{money(z.invest_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="z-pad z-muted small">* As the state reports them: cumulative since the program began (1984); investment includes companies now inactive.</div>
    </div>
  );
}

// ---------- Industries (active businesses by SIC sector) ----------
function Industries({ data, me, onPick }) {
  const [hover, setHover] = useState(null);
  const zones = data.zones.filter((z) => z.sic_active?.total);
  const keys = Object.keys(SECTOR_LABEL);
  const stateTotals = Object.fromEntries(keys.map((k) => [k, zones.reduce((s, z) => s + (z.sic_active[k] || 0), 0)]));
  const top = keys.sort((a, b) => stateTotals[b] - stateTotals[a]).slice(0, 5);
  const groups = [...top, 'other'];
  const share = (z, g) => (g === 'other' ? Object.entries(z.sic_active).filter(([k]) => k !== 'total' && !top.includes(k)).reduce((s, [, v]) => s + v, 0) : z.sic_active[g] || 0);
  const rows = [...zones].sort((a, b) => (a.zone === me ? -1 : b.zone === me ? 1 : b.sic_active.total - a.sic_active.total));
  const label = (g) => (g === 'other' ? 'Other' : SECTOR_LABEL[g]);
  return (
    <div className="z-card z-pad sw-section">
      <h2 className="z-h2">Industry mix of active businesses</h2>
      <div className="z-muted small">State Participating Company Profile by SIC, {fmtMonth(data.latest_month)}. Each bar is one zone's businesses as 100%.</div>
      <div className="sw-legend">{groups.map((g, i) => <span key={g}><i style={{ background: SECTOR_COLORS[i] }} />{label(g)}</span>)}</div>
      <div className="sw-mix">
        {rows.map((z) => (
          <button key={z.zone} className={`sw-mix-row ${z.zone === me ? 'mine' : ''}`} onClick={() => onPick(z.zone)}>
            <span className="sw-mix-name">{title(z.zone)}{z.zone === me && <span className="sw-you">You</span>}<span className="z-muted small"> {num(z.sic_active.total)}</span></span>
            <span className="sw-mix-bar">
              {groups.map((g, i) => {
                const v = share(z, g); if (!v) return null;
                return <i key={g} style={{ flexGrow: v, background: SECTOR_COLORS[i] }} onMouseEnter={() => setHover({ zone: z.zone, g, v, t: z.sic_active.total })} onMouseLeave={() => setHover(null)} />;
              })}
            </span>
            <span className="sw-mix-top z-hide-sm">{label(groups.reduce((b, g) => (share(z, g) > share(z, b) ? g : b), groups[0]))} {Math.round((Math.max(...groups.map((g) => share(z, g))) / z.sic_active.total) * 100)}%</span>
          </button>
        ))}
      </div>
      <div className="sw-mix-tip" aria-live="polite">{hover ? <>{title(hover.zone)} · <b>{label(hover.g)}</b>: {num(hover.v)} businesses ({Math.round((hover.v / hover.t) * 100)}%)</> : 'Hover a bar segment for its numbers.'}</div>
    </div>
  );
}

// ---------- Compliance ----------
function Compliance({ data, me, onPick }) {
  const [sort, setSort] = useState({ key: 'late', dir: 'desc' });
  const rows = sortRows(data.zones.map((z) => ({ ...z, late_rate: z.due_60 + z.late ? Math.round((z.late / (z.due_60 + z.late)) * 100) : null })), sort);
  const p = { sort, setSort };
  return (
    <div className="z-card sw-section">
      <div className="z-pad"><h2 className="z-h2">Compliance across zones</h2><div className="z-muted small">Today's statewide Companies Due/Late, Tax Delinquencies and Incomplete Applications reports.</div></div>
      <div className="z-table-wrap">
        <table className="z-table">
          <thead><tr><th>Zone</th><SortTh k="due_60" label="Due next 60 days" {...p} /><SortTh k="late" label="Late" {...p} /><SortTh k="late_rate" label="Late share" className="z-hide-sm" {...p} /><SortTh k="tax_delinquent" label="Tax delinquent" {...p} /><SortTh k="incomplete_apps" label="Unfinished applications" className="z-hide-sm" {...p} /></tr></thead>
          <tbody>
            {rows.map((z) => (
              <tr key={z.zone} className={z.zone === me ? 'z-mine' : ''} onClick={() => onPick(z.zone)}>
                <ZoneCell z={z} me={me} />
                <td className="sw-num">{num(z.due_60)}</td>
                <td className="sw-num">{num(z.late)}</td>
                <td className="sw-num z-hide-sm">{z.late_rate == null ? '—' : `${z.late_rate}%`}</td>
                <td className="sw-num">{num(z.tax_delinquent)}</td>
                <td className="sw-num z-hide-sm">{num(z.incomplete_apps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Zone profile drawer ----------
function ZoneProfile({ org, zone, me, overview, onClose, onViewBusinesses }) {
  const [p, setP] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { setP(null); zoneApi.stateZone(org.id, zone).then(setP).catch((e) => setErr(e.message)); }, [org.id, zone]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const z = overview.zones.find((x) => x.zone === zone) || {};
  const r = (k) => rankOf(overview.zones, k, zone);
  const yearly = useMemo(() => {
    if (!p) return [];
    const byYear = new Map(); // latest month per year, plus the most recent month
    for (const m of p.monthly.filter((x) => x.active_businesses != null)) byYear.set(m.report_date.slice(0, 4), m);
    return [...byYear.values()];
  }, [p]);
  const weekly = (p?.weekly || []).slice(-52);
  const recent = useMemo(() => {
    if (!p) return [];
    const weeks = [...new Set(p.activity.map((a) => a.week_ending))].slice(0, 4);
    return weeks.map((w) => ({ week: w, joined: p.activity.filter((a) => a.week_ending === w && a.kind === 'certified'), dropped: p.activity.filter((a) => a.week_ending === w && a.kind === 'inactivated'), other: p.activity.filter((a) => a.week_ending === w && (a.kind === 'annual' || a.kind === 'recertified')).length }));
  }, [p]);
  return (
    <div className="z-drawer-backdrop" onClick={onClose}>
      <aside className="z-drawer sw-profile" onClick={(e) => e.stopPropagation()} aria-label={`${title(zone)} profile`}>
        <button className="z-close" onClick={onClose} aria-label="Close">×</button>
        <div className="z-drawer-pills"><span className="z-pill">UEZ zone</span>{zone === me && <span className="sw-you">You</span>}</div>
        <h2>{title(zone)}</h2>
        <div className="z-muted small">{fmtDay(overview.range.from)} – {fmtDay(overview.range.to)} for activity · {fmtMonth(overview.latest_month)} for businesses and jobs</div>

        <div className="sw-pkpis">
          <PK label="New businesses" v={num(z.cert)} r={r('cert')} />
          <PK label="Net growth" v={`${z.net > 0 ? '+' : ''}${num(z.net)}`} r={r('net')} />
          <PK label="Active businesses" v={num(z.active_businesses)} r={r('active_businesses')} />
          <PK label="Full-time jobs" v={num(z.ft_jobs)} r={r('ft_jobs')} />
        </div>

        {err && <div className="z-alert bad">{err}</div>}
        {!p ? <div className="z-muted" style={{ padding: '20px 0' }}>Loading profile…</div> : (
          <>
            {yearly.length > 1 && (
              <>
                <h3>Active businesses over time</h3>
                <LineChart height={180} labels={yearly.map((m) => m.report_date)} xFmt={(l, long) => (long ? fmtMonth(l) : l.slice(0, 4))}
                  series={[{ key: 'a', label: 'Active', color: 'var(--blue)', values: yearly.map((m) => m.active_businesses) }]} />
              </>
            )}
            {weekly.length > 1 && (
              <>
                <h3>New businesses per week (last {weekly.length} weeks)</h3>
                <Columns labels={weekly.map((w) => w.week_ending)} values={weekly.map((w) => w.cert_total || 0)} xFmt={(l, long) => (long ? `Week of ${fmtDay(l)}` : fmtShort(l))} />
              </>
            )}
            {z.sic_active?.total > 0 && <ProfileMix z={z} state={p.state_sic} />}

            <h3>Recent weeks</h3>
            {!recent.length && <div className="z-muted small">No processed activity loaded yet.</div>}
            {recent.map((w) => (
              <div key={w.week} className="sw-week">
                <div className="sw-week-h">Week of {fmtDay(w.week)} <span className="z-muted small">· {w.joined.length} joined · {w.dropped.length} dropped · {w.other} annual/recert</span></div>
                {w.joined.length > 0 && <div className="sw-names"><span className="sw-feed-k">Joined</span> {w.joined.map((a) => title(a.name)).join(' · ')}</div>}
                {w.dropped.length > 0 && <div className="sw-names"><span className="sw-feed-k">Dropped</span> {w.dropped.map((a) => title(a.name)).join(' · ')}</div>}
              </div>
            ))}

            <h3>Tax delinquent now ({p.tax_delinquent.length})</h3>
            {p.tax_delinquent.length ? (
              <table className="z-mini"><thead><tr><th>Business</th><th>Days delinquent</th></tr></thead>
                <tbody>{[...p.tax_delinquent].sort((a, b) => b.days - a.days).slice(0, 25).map((t) => <tr key={t.file_no}><td>{title(t.name)}</td><td>{num(t.days)}</td></tr>)}</tbody></table>
            ) : <div className="z-muted small">None on the state's list.</div>}

            <h3>Unfinished online applications ({p.incomplete_apps.length})</h3>
            {p.incomplete_apps.length ? (
              <table className="z-mini"><thead><tr><th>Business</th><th>Type</th><th>Started</th>{p.own && <th>Contact</th>}</tr></thead>
                <tbody>{p.incomplete_apps.map((a) => (
                  <tr key={`${a.file_no}${a.name}`}><td>{title(a.name)}</td><td>{a.type === 'AR' ? 'Annual' : a.type === 'RCRT' ? 'Recert' : 'New'}</td><td>{fmtShort(a.started)}</td>
                    {p.own && <td>{title(a.contact_name)}<div className="z-muted small">{a.contact_phone} {a.contact_email}</div></td>}</tr>
                ))}</tbody></table>
            ) : <div className="z-muted small">None right now.</div>}

            <button className="btn ghost z-btn" onClick={() => { onClose(); onViewBusinesses(zone); }}>View {zone === me ? 'your' : 'their'} businesses →</button>
          </>
        )}
      </aside>
    </div>
  );
}

function PK({ label, v, r }) {
  return <div className="sw-pk"><div className="sw-pk-l">{label}</div><div className="sw-pk-v">{v}</div>{r && <div className={`sw-rank ${r.rank <= 3 ? 'top' : ''}`}>#{r.rank} of {r.of}</div>}</div>;
}

function ProfileMix({ z, state }) {
  const keys = Object.keys(SECTOR_LABEL);
  const stateTotal = keys.reduce((s, k) => s + (state[k] || 0), 0) || 1;
  const rows = keys.map((k) => ({ k, mine: z.sic_active[k] || 0, pct: (z.sic_active[k] || 0) / z.sic_active.total, statePct: (state[k] || 0) / stateTotal }))
    .filter((r) => r.mine || r.statePct > 0.01).sort((a, b) => b.mine - a.mine).slice(0, 6);
  return (
    <>
      <h3>Top industries</h3>
      <table className="z-mini sw-mixtable">
        <thead><tr><th>Industry</th><th>Businesses</th><th>Share</th><th className="z-hide-sm">State avg</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.k}><td>{SECTOR_LABEL[r.k]}</td><td>{num(r.mine)}</td>
            <td><span className="sw-minibar"><i style={{ width: `${Math.round(r.pct * 100)}%` }} /></span>{Math.round(r.pct * 100)}%</td>
            <td className="z-hide-sm">{Math.round(r.statePct * 100)}%</td></tr>
        ))}</tbody>
      </table>
    </>
  );
}
