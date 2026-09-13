import React, { Component } from 'react';
import JenkinsService from '../services/JenkinsService';
import './Dashboard.css';

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusClass(status) {
    if (status === 'SUCCESS') return 'success';
    if (status === 'FAILURE') return 'failure';
    return 'unknown';
}

function formatTs(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d)) return ts;
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60)  return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString();
}

function computeTrends(history) {
    if (!history || history.length === 0) return null;
    const total = history.length;
    const successes = history.filter(h => h.status === 'SUCCESS').length;
    const successRate = Math.round((successes / total) * 100);
    const avgDuration = Math.round(
        history.reduce((a, h) => a + (h.duration || 0), 0) / total
    );

    // MTTR — time from first failure to next success
    let totalRecoveryMin = 0, recoveries = 0, failStart = null;
    for (const build of history) {
        if (build.status === 'FAILURE' && failStart === null) {
            failStart = new Date(build.timestamp);
        } else if (build.status === 'SUCCESS' && failStart !== null) {
            const diffMin = Math.round((new Date(build.timestamp) - failStart) / 60000);
            if (diffMin > 0) { totalRecoveryMin += diffMin; recoveries++; }
            failStart = null;
        }
    }
    const mttr = recoveries > 0 ? Math.round(totalRecoveryMin / recoveries) : null;

    // Trend: compare last 5 vs previous 5 success rates
    let trend = 'stable';
    if (history.length >= 10) {
        const recent = history.slice(-5).filter(h => h.status === 'SUCCESS').length;
        const older  = history.slice(-10, -5).filter(h => h.status === 'SUCCESS').length;
        if (recent > older) trend = 'improving';
        else if (recent < older) trend = 'degrading';
    }

    return { successRate, avgDuration, mttr, trend, total };
}

// ── Mini chart components ──────────────────────────────────────────────────────

function Sparkline({ values, width = 120, height = 32, color = '#4361ee' }) {
    if (!values || values.length < 2) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
        const x = (i / (values.length - 1)) * width;
        const y = height - ((v - min) / range) * (height - 6) - 3;
        return `${x},${y}`;
    }).join(' ');
    return (
        <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
            <polyline
                points={pts}
                fill="none"
                stroke={color}
                strokeWidth="1.8"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
            {/* last point dot */}
            {values.length > 0 && (() => {
                const lx = width;
                const ly = height - ((values[values.length - 1] - min) / range) * (height - 6) - 3;
                return <circle cx={lx} cy={ly} r="2.5" fill={color} />;
            })()}
        </svg>
    );
}

function StatusDots({ history, count = 12 }) {
    if (!history || history.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>;
    const recent = history.slice(-count);
    return (
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            {recent.map((h, i) => (
                <div
                    key={i}
                    title={`${h.status} — ${h.duration}s`}
                    style={{
                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: h.status === 'SUCCESS' ? '#22c55e'
                            : h.status === 'FAILURE' ? '#ef4444'
                            : '#475569',
                    }}
                />
            ))}
        </div>
    );
}

function TrendBadge({ trend }) {
    const cfg = {
        improving: { label: '↑ Improving', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
        degrading:  { label: '↓ Degrading', color: '#ef4444', bg: 'rgba(239,68,68,0.1)'  },
        stable:     { label: '→ Stable',    color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
    };
    const c = cfg[trend] || cfg.stable;
    return (
        <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
            color: c.color, background: c.bg,
        }}>
            {c.label}
        </span>
    );
}

function DurationBar({ value, max }) {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    return (
        <div className="duration-cell">
            <span style={{ minWidth: 36, color: 'var(--text-secondary)', fontSize: 12 }}>
                {value}s
            </span>
            <div className="duration-bar-bg">
                <div className="duration-bar-fill" style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

function SkeletonRows() {
    return Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="skeleton-row">
            <td><div className="skeleton" style={{ width: '70%' }} /></td>
            <td><div className="skeleton" style={{ width: 60 }} /></td>
            <td><div className="skeleton" style={{ width: 80 }} /></td>
            <td><div className="skeleton" style={{ width: 90 }} /></td>
            <td><div className="skeleton" style={{ width: 50 }} /></td>
            <td><div className="skeleton" style={{ width: 55 }} /></td>
        </tr>
    ));
}

// ── Main component ─────────────────────────────────────────────────────────────

class JenkinsDashboardComponent extends Component {
    constructor(props) {
        super(props);
        this.state = {
            jobs: [],
            loading: false,
            error: null,
            jobDetails: null,
            jobSummary: null,
            selectedJob: null,
            showDetails: false,
            showConfig: false,
            demoMode: false,
            activeTab: 'jobs',
            search: '',
            triggeringJob: null,
            triggerMsg: null,
            trendsData: {},       // jobName → { history, trends }
            loadingTrends: false,
            wsConnected: false,
            jenkinsConfig: {
                url: 'http://localhost:8080',
                user: '',
                token: '',
                job: 'test-job',
                slackWebhookUrl: '',
            },
        };
        this.ws = null;
        this.handlePoll          = this.handlePoll.bind(this);
        this.fetchJobDetails     = this.fetchJobDetails.bind(this);
        this.testConnection      = this.testConnection.bind(this);
        this.updateJenkinsConfig = this.updateJenkinsConfig.bind(this);
        this.handleConfigChange  = this.handleConfigChange.bind(this);
        this.toggleDemoMode      = this.toggleDemoMode.bind(this);
        this.closeDrawer         = this.closeDrawer.bind(this);
        this.triggerBuild        = this.triggerBuild.bind(this);
        this.loadTrendsTab       = this.loadTrendsTab.bind(this);
    }

    componentDidMount() {
        JenkinsService.getJenkinsConfig()
            .then(res => this.setState({ jenkinsConfig: { ...this.state.jenkinsConfig, ...res.data } }))
            .catch(() => {});
        this.fetchJobs();
        this.connectWebSocket();
    }

    componentWillUnmount() {
        if (this.ws) this.ws.close();
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}/ws/jobs`;
        const connect = () => {
            this.ws = new WebSocket(url);
            this.ws.onopen = () => {
                this.setState({ wsConnected: true });
            };
            this.ws.onmessage = (event) => {
                try {
                    const jobs = JSON.parse(event.data);
                    if (Array.isArray(jobs) && jobs.length > 0) {
                        this.setState({ jobs, loading: false });
                    }
                } catch (_) {}
            };
            this.ws.onclose = () => {
                this.setState({ wsConnected: false });
                // Reconnect after 5s
                setTimeout(connect, 5000);
            };
            this.ws.onerror = () => {
                this.ws.close();
            };
        };
        connect();
    }

    fetchJobs() {
        this.setState({ loading: true });
        JenkinsService.getJobs()
            .then(res => this.setState({ jobs: res.data, loading: false }))
            .catch(err => this.setState({ error: err.message, loading: false }));
    }

    handlePoll() {
        this.setState({ loading: true, error: null });
        JenkinsService.pollJob()
            .then(res => {
                if (res.data.status === 'success') {
                    this.setState({ jobs: res.data.jobs || [], loading: false });
                } else {
                    this.setState({ error: res.data.message || 'Polling failed', loading: false });
                }
            })
            .catch(err => this.setState({ error: 'Failed to connect to Jenkins: ' + err.message, loading: false }));
    }

    fetchJobDetails(job) {
        this.setState({ selectedJob: job, jobDetails: null, jobSummary: null, showDetails: true });
        const call = this.state.demoMode
            ? JenkinsService.getMockJobDetails(job.jobName)
            : JenkinsService.getJobDetails(job.jobName);
        call.then(res => this.setState({ jobDetails: res.data }))
            .catch(err => this.setState({ error: err.message }));
        if (!this.state.demoMode) {
            JenkinsService.getJobSummary(job.jobName)
                .then(res => this.setState({ jobSummary: res.data }))
                .catch(() => {});
        }
    }

    loadTrendsTab() {
        const { jobs, demoMode, trendsData } = this.state;
        // Only fetch jobs we don't have trend data for yet
        const missing = jobs.filter(j => !trendsData[j.jobName]);
        if (missing.length === 0) return;

        this.setState({ loadingTrends: true });
        const calls = missing.map(j =>
            (demoMode ? JenkinsService.getMockJobDetails(j.jobName) : JenkinsService.getJobDetails(j.jobName))
                .then(res => ({ jobName: j.jobName, data: res.data }))
                .catch(() => ({ jobName: j.jobName, data: null }))
        );

        Promise.all(calls).then(results => {
            const newTrends = { ...this.state.trendsData };
            results.forEach(({ jobName, data }) => {
                if (data) {
                    newTrends[jobName] = {
                        history: data.history || [],
                        trends: computeTrends(data.history || []),
                    };
                }
            });
            this.setState({ trendsData: newTrends, loadingTrends: false });
        });
    }

    closeDrawer() {
        this.setState({ showDetails: false, selectedJob: null, jobDetails: null, jobSummary: null });
    }

    triggerBuild(e, jobName) {
        e.stopPropagation();
        this.setState({ triggeringJob: jobName, triggerMsg: null });
        JenkinsService.triggerBuild(jobName)
            .then(res => {
                const msg = res.data.status === 'success'
                    ? { type: 'success', text: `Build triggered for ${jobName}` }
                    : { type: 'error', text: res.data.message || 'Trigger failed' };
                this.setState({ triggeringJob: null, triggerMsg: msg });
                setTimeout(() => this.setState({ triggerMsg: null }), 4000);
            })
            .catch(err => {
                this.setState({ triggeringJob: null, triggerMsg: { type: 'error', text: 'Trigger failed: ' + err.message } });
                setTimeout(() => this.setState({ triggerMsg: null }), 4000);
            });
    }

    toggleDemoMode() {
        const entering = !this.state.demoMode;
        this.setState({ demoMode: entering, jobs: [], error: null, showDetails: false, trendsData: {} }, () => {
            if (entering) {
                this.setState({ loading: true });
                JenkinsService.getMockJobs()
                    .then(res => this.setState({ jobs: res.data, loading: false }))
                    .catch(err => this.setState({ error: err.message, loading: false }));
            }
        });
    }

    handleConfigChange(field, value) {
        this.setState({ jenkinsConfig: { ...this.state.jenkinsConfig, [field]: value } });
    }

    updateJenkinsConfig() {
        this.setState({ loading: true });
        JenkinsService.updateJenkinsConfig(this.state.jenkinsConfig)
            .then(res => {
                if (res.data.status === 'success') {
                    this.setState({ jobs: res.data.jobs || [], loading: false, showConfig: false, error: null });
                } else {
                    this.setState({ error: res.data.message || 'Configuration update failed', loading: false });
                }
            })
            .catch(err => this.setState({ error: 'Configuration update failed: ' + err.message, loading: false }));
    }

    testConnection() {
        this.setState({ loading: true, error: null });
        JenkinsService.testConnection()
            .then(res => {
                if (res.data.status === 'success') {
                    this.setState({ jobs: res.data.jobs || [], loading: false });
                } else {
                    this.setState({ error: res.data.message || 'Connection test failed', loading: false });
                }
            })
            .catch(err => this.setState({ error: 'Connection test failed: ' + err.message, loading: false }));
    }

    render() {
        const { jobs, loading, error, jobDetails, jobSummary, selectedJob, showDetails,
                showConfig, demoMode, activeTab, search, jenkinsConfig,
                triggeringJob, triggerMsg, trendsData, loadingTrends, wsConnected } = this.state;

        const filtered = jobs.filter(j =>
            !search || j.jobName.toLowerCase().includes(search.toLowerCase())
        );
        const maxDur  = Math.max(...jobs.map(j => j.duration || 0), 1);
        const total   = jobs.length;
        const success = jobs.filter(j => j.status === 'SUCCESS').length;
        const failed  = jobs.filter(j => j.status === 'FAILURE').length;
        const avgDur  = jobs.length ? Math.round(jobs.reduce((a, j) => a + (j.duration || 0), 0) / jobs.length) : 0;

        const drawerTrends = jobDetails ? computeTrends(jobDetails.history || []) : null;

        return (
            <div className="argus-root">

                {/* ── Top bar ── */}
                <header className="argus-topbar">
                    <div className="argus-logo">
                        <div className="argus-logo-icon">🔭</div>
                        <div>
                            <div className="argus-logo-text">Argus Agent</div>
                            <div className="argus-logo-sub">DevOps Intelligence</div>
                        </div>
                    </div>

                    <div className="topbar-divider" />

                    <div className="live-pill" title={wsConnected ? 'WebSocket connected — receiving live updates' : 'WebSocket disconnected — updates paused'} style={{ opacity: wsConnected ? 1 : 0.45 }}>
                        <div className="live-dot" style={{ background: wsConnected ? undefined : '#94a3b8', animation: wsConnected ? undefined : 'none' }} />
                        {wsConnected ? 'LIVE' : 'OFFLINE'}
                    </div>

                    <div className="topbar-spacer" />

                    <div className="topbar-actions">
                        <button
                            className={`btn ${demoMode ? 'btn-ghost-active' : 'btn-ghost'}`}
                            onClick={this.toggleDemoMode}
                            disabled={loading}
                            title="Load mock pipelines — no Jenkins connection needed"
                        >
                            {demoMode ? '⬡ Exit Demo' : '⬡ Demo'}
                        </button>
                        <button
                            className="btn btn-ghost"
                            onClick={this.testConnection}
                            disabled={loading}
                            title="Test Jenkins connection"
                        >
                            ⬡ Test Connection
                        </button>
                        <button
                            className="btn btn-ghost"
                            onClick={() => this.setState({ showConfig: true })}
                            title="Configure Jenkins URL, username and API token"
                        >
                            ⚙ Configure Jenkins
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={this.handlePoll}
                            disabled={loading}
                        >
                            {loading
                                ? <><div className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} /> Refreshing</>
                                : '↻ Refresh Jobs'}
                        </button>
                    </div>
                </header>

                {/* ── Tab nav ── */}
                <nav className="argus-tabs">
                    <button
                        className={`argus-tab${activeTab === 'jobs' ? ' active' : ''}`}
                        onClick={() => this.setState({ activeTab: 'jobs' })}
                    >
                        ⬡ Pipelines
                        <span className="tab-count">{total}</span>
                    </button>
                    <button
                        className={`argus-tab${activeTab === 'trends' ? ' active' : ''}`}
                        onClick={() => { this.setState({ activeTab: 'trends' }); this.loadTrendsTab(); }}
                    >
                        ↗ Trends
                    </button>
                    <button
                        className={`argus-tab${activeTab === 'grafana' ? ' active' : ''}`}
                        onClick={() => this.setState({ activeTab: 'grafana' })}
                    >
                        ▦ Monitoring
                    </button>
                </nav>

                {/* ── Main content ── */}
                <main className="argus-content">

                    {triggerMsg && (
                        <div className={`banner ${triggerMsg.type === 'success' ? 'info' : 'error'}`}>
                            <span>{triggerMsg.type === 'success' ? '▶' : '⚠'}</span>
                            <span>{triggerMsg.text}</span>
                            <button onClick={() => this.setState({ triggerMsg: null })}
                                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}>×</button>
                        </div>
                    )}

                    {error && (
                        <div className="banner error">
                            <span>⚠</span>
                            <span>{error}</span>
                            <button
                                onClick={() => this.setState({ error: null })}
                                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}
                            >×</button>
                        </div>
                    )}

                    {demoMode && (
                        <div className="banner info">
                            <span>ℹ</span>
                            <span><strong>Demo Mode</strong> — showing mock pipelines with pre-built history and AI insights. No Jenkins connection needed.</span>
                        </div>
                    )}

                    {/* ── Jobs tab ── */}
                    {activeTab === 'jobs' && (
                        <>
                            <div className="stats-row">
                                <div className="stat-card">
                                    <div className="stat-label">Total Pipelines</div>
                                    <div className="stat-value">{total}</div>
                                    <div className="stat-sub">monitored jobs</div>
                                </div>
                                <div className="stat-card success">
                                    <div className="stat-label">Passing</div>
                                    <div className="stat-value">{success}</div>
                                    <div className="stat-sub">{total ? Math.round(success/total*100) : 0}% success rate</div>
                                </div>
                                <div className="stat-card failure">
                                    <div className="stat-label">Failing</div>
                                    <div className="stat-value">{failed}</div>
                                    <div className="stat-sub">{total ? Math.round(failed/total*100) : 0}% failure rate</div>
                                </div>
                                <div className="stat-card accent">
                                    <div className="stat-label">Avg Duration</div>
                                    <div className="stat-value">{avgDur}s</div>
                                    <div className="stat-sub">across all jobs</div>
                                </div>
                            </div>

                            <div className="table-toolbar">
                                <input
                                    className="search-input"
                                    placeholder="Search pipelines…"
                                    value={search}
                                    onChange={e => this.setState({ search: e.target.value })}
                                />
                                <div style={{ flex: 1 }} />
                                <button className="btn btn-ghost btn-sm" onClick={this.testConnection} disabled={loading}>
                                    ⬡ Test Connection
                                </button>
                            </div>

                            <div className="jobs-table-wrap">
                                <table className="jobs-table">
                                    <thead>
                                        <tr>
                                            <th>Pipeline</th>
                                            <th>Status</th>
                                            <th>Duration</th>
                                            <th>Last Run</th>
                                            <th>Anomaly</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {loading && jobs.length === 0 && <SkeletonRows />}
                                        {!loading && filtered.length === 0 && (
                                            <tr>
                                                <td colSpan="6">
                                                    <div className="empty-state">
                                                        <div className="empty-icon">⬡</div>
                                                        <div className="empty-title">No pipelines found</div>
                                                        <div className="empty-sub">
                                                            {search ? 'No jobs match your search.' : 'Click Refresh or configure your Jenkins connection.'}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                        {filtered.map(job => (
                                            <tr key={job.jobName} onClick={() => this.fetchJobDetails(job)}>
                                                <td>
                                                    <div className="job-name-cell">
                                                        <div className={`status-dot ${statusClass(job.status)}`} />
                                                        <span className="job-name" title={job.jobName}>{job.jobName}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className={`status-pill ${statusClass(job.status)}`}>
                                                        {job.status === 'SUCCESS' ? '✓' : job.status === 'FAILURE' ? '✗' : '○'}
                                                        {' '}{job.status || 'UNKNOWN'}
                                                    </span>
                                                </td>
                                                <td><DurationBar value={job.duration || 0} max={maxDur} /></td>
                                                <td><span className="ts-text">{formatTs(job.timestamp)}</span></td>
                                                <td>
                                                    {job.anomaly && <span className="anomaly-badge">⚠ Anomaly</span>}
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', gap: 6 }}>
                                                        <button
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={e => { e.stopPropagation(); this.fetchJobDetails(job); }}
                                                        >View →</button>
                                                        {!demoMode && (
                                                            <button
                                                                className="btn btn-sm"
                                                                style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--success)', border: '1px solid rgba(34,197,94,0.25)' }}
                                                                onClick={e => this.triggerBuild(e, job.jobName)}
                                                                disabled={triggeringJob === job.jobName}
                                                            >
                                                                {triggeringJob === job.jobName ? '…' : '▶ Run'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {/* ── Trends tab ── */}
                    {activeTab === 'trends' && (
                        <div>
                            <div style={{ marginBottom: 20 }}>
                                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                                    Pipeline Health Trends
                                </div>
                                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                    Success rate, duration sparklines, and MTTR across all monitored jobs.
                                    {loadingTrends && <span style={{ marginLeft: 8, opacity: 0.6 }}>Loading…</span>}
                                </div>
                            </div>

                            {jobs.length === 0 ? (
                                <div className="empty-state">
                                    <div className="empty-icon">↗</div>
                                    <div className="empty-title">No pipelines loaded</div>
                                    <div className="empty-sub">Go to Pipelines tab and refresh first.</div>
                                </div>
                            ) : (
                                <div className="jobs-table-wrap">
                                    <table className="jobs-table">
                                        <thead>
                                            <tr>
                                                <th>Pipeline</th>
                                                <th>Success Rate</th>
                                                <th>Duration Trend</th>
                                                <th>Last 12 Builds</th>
                                                <th>Avg Duration</th>
                                                <th>MTTR</th>
                                                <th>Trend</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {jobs.map(job => {
                                                const td = trendsData[job.jobName];
                                                const t = td?.trends;
                                                const history = td?.history || [];
                                                const durations = history.map(h => h.duration || 0);
                                                return (
                                                    <tr key={job.jobName} onClick={() => this.fetchJobDetails(job)} style={{ cursor: 'pointer' }}>
                                                        <td>
                                                            <div className="job-name-cell">
                                                                <div className={`status-dot ${statusClass(job.status)}`} />
                                                                <span className="job-name">{job.jobName}</span>
                                                            </div>
                                                        </td>
                                                        <td>
                                                            {t ? (
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                    <div style={{
                                                                        width: 44, height: 44, borderRadius: '50%',
                                                                        background: `conic-gradient(${t.successRate >= 80 ? '#22c55e' : t.successRate >= 50 ? '#f59e0b' : '#ef4444'} ${t.successRate}%, rgba(255,255,255,0.08) 0)`,
                                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                    }}>
                                                                        <div style={{
                                                                            width: 32, height: 32, borderRadius: '50%',
                                                                            background: 'var(--surface)',
                                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                            fontSize: 10, fontWeight: 700,
                                                                            color: t.successRate >= 80 ? '#22c55e' : t.successRate >= 50 ? '#f59e0b' : '#ef4444',
                                                                        }}>
                                                                            {t.successRate}%
                                                                        </div>
                                                                    </div>
                                                                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                                                        {history.filter(h => h.status === 'SUCCESS').length}/{t.total} builds
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                                                                    {loadingTrends ? 'Loading…' : 'Click to load'}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td>
                                                            <Sparkline
                                                                values={durations}
                                                                color={t?.trend === 'degrading' ? '#ef4444' : t?.trend === 'improving' ? '#22c55e' : '#4361ee'}
                                                            />
                                                        </td>
                                                        <td><StatusDots history={history} /></td>
                                                        <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                                            {t ? `${t.avgDuration}s` : '—'}
                                                        </td>
                                                        <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                                            {t?.mttr != null ? `${t.mttr}m` : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                                        </td>
                                                        <td>
                                                            {t ? <TrendBadge trend={t.trend} /> : '—'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Monitoring tab ── */}
                    {activeTab === 'grafana' && (
                        <div className="grafana-wrap">
                            <div className="grafana-panel">
                                <div className="grafana-panel-header">
                                    <div className="grafana-panel-title">▦ Jenkins Pipelines</div>
                                    <a href="http://localhost:3001/d/jenkins-pipelines" target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Open ↗</a>
                                </div>
                                <iframe src="http://localhost:3001/d/jenkins-pipelines/argus-agent-jenkins-pipelines?orgId=1&refresh=30s&kiosk" height="560" title="Jenkins Pipelines" />
                            </div>
                            <div className="grafana-panel">
                                <div className="grafana-panel-header">
                                    <div className="grafana-panel-title">▦ Argus Overview</div>
                                    <a href="http://localhost:3001/d/argus-overview" target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Open ↗</a>
                                </div>
                                <iframe src="http://localhost:3001/d/argus-overview/argus-agent-overview?orgId=1&refresh=30s&kiosk" height="460" title="Argus Overview" />
                            </div>
                        </div>
                    )}
                </main>

                {/* ── Job detail drawer ── */}
                {showDetails && (
                    <>
                        <div className="drawer-overlay" onClick={this.closeDrawer} />
                        <aside className="drawer">
                            <div className="drawer-header">
                                <div>
                                    <div className="drawer-title">{selectedJob?.jobName}</div>
                                    <div className="drawer-subtitle">Build insights · AI analysis · Trends</div>
                                </div>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    {!demoMode && selectedJob && (
                                        <button
                                            className="btn btn-sm"
                                            style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--success)', border: '1px solid rgba(34,197,94,0.25)' }}
                                            onClick={e => this.triggerBuild(e, selectedJob.jobName)}
                                            disabled={triggeringJob === selectedJob?.jobName}
                                        >
                                            {triggeringJob === selectedJob?.jobName ? '…' : '▶ Trigger Build'}
                                        </button>
                                    )}
                                    <button className="close-btn" onClick={this.closeDrawer}>×</button>
                                </div>
                            </div>

                            <div className="drawer-body">
                                {!jobDetails ? (
                                    <div className="drawer-loading">
                                        <div className="spinner" />
                                        Fetching build data…
                                    </div>
                                ) : (
                                    <>
                                        {/* AI Insight */}
                                        <div className="insight-box">
                                            <div className="insight-header">✦ AI Insight</div>
                                            <div className="insight-text">
                                                {jobDetails.insight || 'No insight available for this build.'}
                                            </div>
                                        </div>

                                        {/* Anomaly flag */}
                                        {jobDetails.anomaly && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span className="anomaly-badge">⚠ Anomaly Detected</span>
                                                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                                    build duration or status is outside normal range
                                                </span>
                                            </div>
                                        )}

                                        {/* Trend metrics */}
                                        {drawerTrends && (
                                            <div>
                                                <div className="section-title">Health Metrics</div>
                                                <div className="summary-grid">
                                                    <div className="summary-card">
                                                        <div className="summary-card-label">Success Rate</div>
                                                        <div className="summary-card-value" style={{
                                                            color: drawerTrends.successRate >= 80 ? 'var(--success)' : drawerTrends.successRate >= 50 ? '#f59e0b' : 'var(--failure)'
                                                        }}>
                                                            {drawerTrends.successRate}%
                                                        </div>
                                                    </div>
                                                    <div className="summary-card">
                                                        <div className="summary-card-label">Avg Duration</div>
                                                        <div className="summary-card-value">{drawerTrends.avgDuration}s</div>
                                                    </div>
                                                    <div className="summary-card">
                                                        <div className="summary-card-label">MTTR</div>
                                                        <div className="summary-card-value">
                                                            {drawerTrends.mttr != null ? `${drawerTrends.mttr}m` : '—'}
                                                        </div>
                                                    </div>
                                                    <div className="summary-card">
                                                        <div className="summary-card-label">Trend</div>
                                                        <div className="summary-card-value" style={{ paddingTop: 2 }}>
                                                            <TrendBadge trend={drawerTrends.trend} />
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Duration sparkline */}
                                                {jobDetails.history && jobDetails.history.length > 1 && (
                                                    <div style={{ marginTop: 16 }}>
                                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                                                            Duration over last {jobDetails.history.length} builds
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                            <Sparkline
                                                                values={jobDetails.history.map(h => h.duration || 0)}
                                                                width={200}
                                                                height={40}
                                                                color={drawerTrends.trend === 'degrading' ? '#ef4444' : '#4361ee'}
                                                            />
                                                            <StatusDots history={jobDetails.history} count={15} />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Build summary */}
                                        {jobSummary && (
                                            <div>
                                                <div className="section-title">Latest Build</div>
                                                <div className="summary-grid">
                                                    <div className="summary-card">
                                                        <div className="summary-card-label">Build #</div>
                                                        <div className="summary-card-value">#{jobSummary.buildNumber}</div>
                                                    </div>
                                                    <div className="summary-card">
                                                        <div className="summary-card-label">Result</div>
                                                        <div className="summary-card-value" style={{ color: jobSummary.result === 'SUCCESS' ? 'var(--success)' : jobSummary.result === 'FAILURE' ? 'var(--failure)' : 'var(--text-secondary)' }}>
                                                            {jobSummary.result || 'UNKNOWN'}
                                                        </div>
                                                    </div>
                                                    <div className="summary-card">
                                                        <div className="summary-card-label">Duration</div>
                                                        <div className="summary-card-value">{jobSummary.durationSeconds}s</div>
                                                    </div>
                                                    <div className="summary-card">
                                                        <div className="summary-card-label">Started</div>
                                                        <div className="summary-card-value" style={{ fontSize: 12, fontWeight: 500 }}>{formatTs(jobSummary.timestamp)}</div>
                                                    </div>
                                                    {jobSummary.queueWaitMs > 0 && (
                                                        <div className="summary-card">
                                                            <div className="summary-card-label">Queue Wait</div>
                                                            <div className="summary-card-value">{jobSummary.queueWaitMs}ms</div>
                                                        </div>
                                                    )}
                                                    {jobSummary.startedBy && (
                                                        <div className="summary-card">
                                                            <div className="summary-card-label">Triggered By</div>
                                                            <div className="summary-card-value" style={{ fontSize: 12 }}>{jobSummary.startedBy}</div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Build history */}
                                        {jobDetails.history && jobDetails.history.length > 0 && (
                                            <div>
                                                <div className="section-title">Build History</div>
                                                <table className="history-table">
                                                    <thead>
                                                        <tr>
                                                            <th>Timestamp</th>
                                                            <th>Status</th>
                                                            <th>Duration</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {jobDetails.history.map((h, i) => (
                                                            <tr key={i}>
                                                                <td>{formatTs(h.timestamp)}</td>
                                                                <td>
                                                                    <span className={`status-pill ${statusClass(h.status)}`} style={{ fontSize: 10 }}>
                                                                        {h.status || 'UNKNOWN'}
                                                                    </span>
                                                                </td>
                                                                <td>{h.duration}s</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </aside>
                    </>
                )}

                {/* ── Config modal ── */}
                {showConfig && (
                    <div
                        onClick={() => this.setState({ showConfig: false })}
                        style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.50)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <div
                            onClick={e => e.stopPropagation()}
                            style={{ background: '#ffffff', borderRadius: 14, width: 520, maxWidth: '95vw', boxShadow: '0 24px 64px rgba(0,0,0,0.22)', fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #e2e8f0' }}>
                                <div>
                                    <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a' }}>Jenkins Configuration</div>
                                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Connect Argus Agent to your Jenkins server</div>
                                </div>
                                <button onClick={() => this.setState({ showConfig: false })} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, width: 32, height: 32, fontSize: 18, cursor: 'pointer', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                            </div>
                            <div style={{ padding: '24px 24px 8px' }}>
                                <div style={{ marginBottom: 18 }}>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>Jenkins URL</label>
                                    <input type="text" value={jenkinsConfig.url} onChange={e => this.handleConfigChange('url', e.target.value)} placeholder="http://localhost:8080" style={{ display: 'block', width: '100%', padding: '10px 13px', fontSize: 14, color: '#0f172a', background: '#f8faff', border: '1.5px solid #cbd5e1', borderRadius: 7, outline: 'none', fontFamily: 'system-ui, sans-serif' }} />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>Username</label>
                                        <input type="text" value={jenkinsConfig.user} onChange={e => this.handleConfigChange('user', e.target.value)} placeholder="admin" style={{ display: 'block', width: '100%', padding: '10px 13px', fontSize: 14, color: '#0f172a', background: '#f8faff', border: '1.5px solid #cbd5e1', borderRadius: 7, outline: 'none', fontFamily: 'system-ui, sans-serif' }} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>API Token</label>
                                        <input type="password" value={jenkinsConfig.token} onChange={e => this.handleConfigChange('token', e.target.value)} placeholder="Your Jenkins API token" style={{ display: 'block', width: '100%', padding: '10px 13px', fontSize: 14, color: '#0f172a', background: '#f8faff', border: '1.5px solid #cbd5e1', borderRadius: 7, outline: 'none', fontFamily: 'system-ui, sans-serif' }} />
                                    </div>
                                </div>
                                {/* Slack Webhook */}
                                <div style={{ marginBottom: 18 }}>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
                                        Slack Webhook URL
                                        <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>optional</span>
                                    </label>
                                    <input
                                        type="password"
                                        value={jenkinsConfig.slackWebhookUrl}
                                        onChange={e => this.handleConfigChange('slackWebhookUrl', e.target.value)}
                                        placeholder="https://hooks.slack.com/services/..."
                                        style={{ display: 'block', width: '100%', padding: '10px 13px', fontSize: 14, color: '#0f172a', background: '#f8faff', border: '1.5px solid #cbd5e1', borderRadius: 7, outline: 'none', fontFamily: 'system-ui, sans-serif' }}
                                    />
                                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                                        Alerts for failures, anomalies, and recoveries go to your channel. Leave blank to disable.
                                    </div>
                                </div>

                                <div style={{ fontSize: 12, color: '#64748b', background: '#f8faff', border: '1px solid #e2e8f0', borderRadius: 7, padding: '10px 14px', marginBottom: 24 }}>
                                    💡 Get your API token: Jenkins → click your username → Configure → API Token → Generate New Token
                                </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', background: '#f8faff', borderTop: '1px solid #e2e8f0' }}>
                                <button onClick={() => this.setState({ showConfig: false })} style={{ padding: '9px 18px', fontSize: 13, fontWeight: 500, color: '#475569', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer', fontFamily: 'system-ui, sans-serif' }}>Cancel</button>
                                <button
                                    onClick={this.updateJenkinsConfig}
                                    disabled={loading || !jenkinsConfig.user || !jenkinsConfig.token}
                                    style={{ padding: '9px 20px', fontSize: 13, fontWeight: 600, color: '#fff', background: loading || !jenkinsConfig.user || !jenkinsConfig.token ? '#94a3b8' : '#4361ee', border: 'none', borderRadius: 7, cursor: loading || !jenkinsConfig.user || !jenkinsConfig.token ? 'not-allowed' : 'pointer', fontFamily: 'system-ui, sans-serif' }}
                                >
                                    {loading ? 'Saving…' : 'Save & Connect'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }
}

export default JenkinsDashboardComponent;
