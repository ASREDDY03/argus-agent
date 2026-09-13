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

function StreakBadge({ count }) {
    if (!count || count < 2) return null;
    const color = count >= 5 ? '#ef4444' : count >= 3 ? '#f59e0b' : '#f97316';
    const bg    = count >= 5 ? 'rgba(239,68,68,0.12)' : count >= 3 ? 'rgba(245,158,11,0.12)' : 'rgba(249,115,22,0.12)';
    return (
        <span title={`${count} consecutive failures`} style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            color, background: bg, letterSpacing: '0.03em',
        }}>
            ✗{count} streak
        </span>
    );
}

function SlaBadge({ breach }) {
    if (!breach) return null;
    return (
        <span title="Build exceeded configured SLA threshold" style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            color: '#9333ea', background: 'rgba(147,51,234,0.12)', letterSpacing: '0.03em',
        }}>
            ⏱ SLA Breach
        </span>
    );
}

function HealthScore({ score }) {
    if (score == null) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>;
    const color = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
    const bg    = score >= 80 ? 'rgba(34,197,94,0.12)' : score >= 50 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)';
    return (
        <div title={`Health score: ${score}/100`} style={{
            width: 36, height: 36, borderRadius: '50%',
            background: `conic-gradient(${color} ${score}%, rgba(255,255,255,0.06) 0)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
            <div style={{
                width: 26, height: 26, borderRadius: '50%', background: 'var(--surface)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 800, color,
            }}>
                {score}
            </div>
        </div>
    );
}

function RiskBadge({ riskLevel, probability }) {
    if (!riskLevel || riskLevel === 'LOW') return null;
    const cfg = {
        HIGH:   { label: '▲ HIGH RISK',   color: '#ef4444', bg: 'rgba(239,68,68,0.12)'  },
        MEDIUM: { label: '◆ MEDIUM RISK', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    };
    const c = cfg[riskLevel];
    if (!c) return null;
    return (
        <span title={`Failure probability: ${Math.round((probability || 0) * 100)}%`} style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            color: c.color, background: c.bg, letterSpacing: '0.03em',
        }}>
            {c.label}
        </span>
    );
}

function FlakyBadge({ flaky, score }) {
    if (!flaky) return null;
    const pct = Math.round((score || 0) * 100);
    return (
        <span title={`Flakiness score: ${pct}% of consecutive build pairs flipped status`} style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            color: '#f59e0b', background: 'rgba(245,158,11,0.12)', letterSpacing: '0.03em',
        }}>
            ⚡ FLAKY {pct}%
        </span>
    );
}

function ProbabilityBar({ probability, riskLevel }) {
    if (probability == null) return null;
    const pct = Math.round(probability * 100);
    const color = riskLevel === 'HIGH' ? '#ef4444' : riskLevel === 'MEDIUM' ? '#f59e0b' : '#22c55e';
    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Failure probability (next build)</span>
                <span style={{ fontSize: 12, fontWeight: 700, color }}>{pct}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
            </div>
        </div>
    );
}

function StageTimeline({ stages }) {
    if (!stages || stages.length === 0) return null;
    const maxDur = Math.max(...stages.map(s => s.durationSeconds || 0), 1);
    const statusColor = s => s === 'SUCCESS' ? '#22c55e' : s === 'FAILED' ? '#ef4444' : s === 'IN_PROGRESS' ? '#4361ee' : '#94a3b8';
    const statusIcon  = s => s === 'SUCCESS' ? '✓' : s === 'FAILED' ? '✗' : s === 'IN_PROGRESS' ? '…' : '○';
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stages.map((stage, i) => {
                const color = statusColor(stage.status);
                const pct   = maxDur > 0 ? Math.min((stage.durationSeconds / maxDur) * 100, 100) : 0;
                return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {/* connector line */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                            {i > 0 && <div style={{ width: 1, height: 6, background: 'rgba(255,255,255,0.1)' }} />}
                            <div style={{
                                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                                background: `${color}22`, border: `2px solid ${color}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 10, fontWeight: 700, color,
                            }}>
                                {statusIcon(stage.status)}
                            </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                                <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {stage.name}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8 }}>
                                    {stage.durationSeconds}s
                                </span>
                            </div>
                            <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, opacity: 0.7 }} />
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
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
            jobStages: null,
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
            alerts: [],
            loadingAlerts: false,
            wsConnected: false,
            jenkinsConfig: {
                url: 'http://localhost:8080',
                user: '',
                token: '',
                job: 'test-job',
                slackWebhookUrl: '',
                slaDurationSeconds: '',
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
        this.setState({ selectedJob: job, jobDetails: null, jobSummary: null, jobStages: null, showDetails: true });
        const call = this.state.demoMode
            ? JenkinsService.getMockJobDetails(job.jobName)
            : JenkinsService.getJobDetails(job.jobName);
        call.then(res => this.setState({ jobDetails: res.data }))
            .catch(err => this.setState({ error: err.message }));
        if (!this.state.demoMode) {
            JenkinsService.getJobSummary(job.jobName)
                .then(res => this.setState({ jobSummary: res.data }))
                .catch(() => {});
            JenkinsService.getJobStages(job.jobName)
                .then(res => this.setState({ jobStages: res.data }))
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

    loadAlertsTab() {
        this.setState({ loadingAlerts: true });
        JenkinsService.getAlerts()
            .then(res => this.setState({ alerts: res.data || [], loadingAlerts: false }))
            .catch(() => this.setState({ loadingAlerts: false }));
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
        const { jobs, loading, error, jobDetails, jobSummary, jobStages, selectedJob, showDetails,
                showConfig, demoMode, activeTab, search, jenkinsConfig,
                triggeringJob, triggerMsg, trendsData, loadingTrends, wsConnected,
                alerts, loadingAlerts } = this.state;

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
                        className={`argus-tab${activeTab === 'alerts' ? ' active' : ''}`}
                        onClick={() => { this.setState({ activeTab: 'alerts' }); this.loadAlertsTab(); }}
                    >
                        🔔 Alerts
                        {alerts.filter(a => {
                            const d = new Date(a.timestamp);
                            return (Date.now() - d) < 86400000;
                        }).length > 0 && (
                            <span className="tab-count">
                                {alerts.filter(a => (Date.now() - new Date(a.timestamp)) < 86400000).length}
                            </span>
                        )}
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
                                {jobs.some(j => j.healthScore != null) && (() => {
                                    const scored = jobs.filter(j => j.healthScore != null);
                                    const fleet = Math.round(scored.reduce((a, j) => a + j.healthScore, 0) / scored.length);
                                    const fleetColor = fleet >= 80 ? 'success' : fleet >= 50 ? 'accent' : 'failure';
                                    return (
                                        <div className={`stat-card ${fleetColor}`}>
                                            <div className="stat-label">Fleet Health</div>
                                            <div className="stat-value">{fleet}</div>
                                            <div className="stat-sub">avg score / 100</div>
                                        </div>
                                    );
                                })()}
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
                                            <th>Health</th>
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
                                                <td style={{ width: 44 }}><HealthScore score={job.healthScore} /></td>
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
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                        {job.anomaly && <span className="anomaly-badge">⚠ Anomaly</span>}
                                                        <StreakBadge count={job.consecutiveFailures} />
                                                        <SlaBadge breach={job.slaBreach} />
                                                        <RiskBadge riskLevel={job.riskLevel} probability={job.failureProbability} />
                                                        <FlakyBadge flaky={job.flaky} score={job.flakinessScore} />
                                                    </div>
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

                    {/* ── Alerts tab ── */}
                    {activeTab === 'alerts' && (
                        <div>
                            <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div>
                                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Alert History</div>
                                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                        Last 100 alerts across all jobs — failures, anomalies, recoveries, SLA breaches.
                                        {loadingAlerts && <span style={{ marginLeft: 8, opacity: 0.6 }}>Loading…</span>}
                                    </div>
                                </div>
                                <button className="btn btn-ghost btn-sm" onClick={() => this.loadAlertsTab()} disabled={loadingAlerts}>↻ Refresh</button>
                            </div>

                            {alerts.length === 0 && !loadingAlerts ? (
                                <div className="empty-state">
                                    <div className="empty-icon">🔔</div>
                                    <div className="empty-title">No alerts yet</div>
                                    <div className="empty-sub">Alerts fire when builds fail, anomalies are detected, or SLA thresholds are breached.</div>
                                </div>
                            ) : (
                                <div className="jobs-table-wrap">
                                    <table className="jobs-table">
                                        <thead>
                                            <tr>
                                                <th>Time</th>
                                                <th>Job</th>
                                                <th>Type</th>
                                                <th>Message</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {alerts.map(alert => {
                                                const typeCfg = {
                                                    FAILURE:    { label: 'Failure',    color: '#ef4444', bg: 'rgba(239,68,68,0.12)'    },
                                                    ANOMALY:    { label: 'Anomaly',    color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'   },
                                                    RECOVERY:   { label: 'Recovery',   color: '#22c55e', bg: 'rgba(34,197,94,0.12)'    },
                                                    SLA_BREACH: { label: 'SLA Breach', color: '#9333ea', bg: 'rgba(147,51,234,0.12)'   },
                                                }[alert.alertType] || { label: alert.alertType, color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
                                                return (
                                                    <tr key={alert.id}>
                                                        <td><span className="ts-text">{formatTs(alert.timestamp)}</span></td>
                                                        <td><span className="job-name" style={{ fontSize: 13 }}>{alert.jobName}</span></td>
                                                        <td>
                                                            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4, color: typeCfg.color, background: typeCfg.bg }}>
                                                                {typeCfg.label}
                                                            </span>
                                                        </td>
                                                        <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {alert.message}
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

                                        {/* SLA breach */}
                                        {jobDetails.slaBreach && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <SlaBadge breach={true} />
                                                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                                    build duration exceeded your configured SLA threshold
                                                </span>
                                            </div>
                                        )}

                                        {/* Failure prediction */}
                                        {jobDetails.failureProbability != null && (
                                            <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '12px 14px' }}>
                                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    ◆ Failure Prediction
                                                    <RiskBadge riskLevel={jobDetails.riskLevel} probability={jobDetails.failureProbability} />
                                                </div>
                                                <ProbabilityBar probability={jobDetails.failureProbability} riskLevel={jobDetails.riskLevel} />
                                            </div>
                                        )}

                                        {/* Trend metrics */}
                                        {drawerTrends && (
                                            <div>
                                                <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    Health Metrics
                                                    {jobDetails.healthScore != null && <HealthScore score={jobDetails.healthScore} />}
                                                </div>
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
                                                    {jobDetails.flakinessScore != null && (
                                                        <div className="summary-card">
                                                            <div className="summary-card-label">Flakiness</div>
                                                            <div className="summary-card-value" style={{ paddingTop: 2 }}>
                                                                <FlakyBadge flaky={jobDetails.flaky} score={jobDetails.flakinessScore} />
                                                                {!jobDetails.flaky && (
                                                                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                                                        {Math.round(jobDetails.flakinessScore * 100)}% — stable
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {jobDetails.consecutiveFailures > 0 && (
                                                        <div className="summary-card">
                                                            <div className="summary-card-label">Failure Streak</div>
                                                            <div className="summary-card-value" style={{ paddingTop: 2 }}>
                                                                <StreakBadge count={jobDetails.consecutiveFailures} />
                                                            </div>
                                                        </div>
                                                    )}
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

                                        {/* Pipeline stages */}
                                        {jobStages && jobStages.length > 0 && (
                                            <div>
                                                <div className="section-title">Pipeline Stages</div>
                                                <StageTimeline stages={jobStages} />
                                            </div>
                                        )}

                                        {/* Build history */}
                                        {jobDetails.history && jobDetails.history.length > 0 && (
                                            <div>
                                                <div className="section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <span>Build History</span>
                                                    {!demoMode && (
                                                        <a
                                                            href={`/api/jobs/${encodeURIComponent(selectedJob?.jobName)}/history/export`}
                                                            download
                                                            className="btn btn-ghost btn-sm"
                                                            style={{ fontSize: 11, textDecoration: 'none' }}
                                                        >
                                                            ↓ CSV
                                                        </a>
                                                    )}
                                                </div>
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

                                {/* SLA threshold */}
                                <div style={{ marginBottom: 18 }}>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>
                                        Build Time SLA
                                        <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>seconds · optional</span>
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={jenkinsConfig.slaDurationSeconds}
                                        onChange={e => this.handleConfigChange('slaDurationSeconds', e.target.value)}
                                        placeholder="e.g. 300"
                                        style={{ display: 'block', width: '100%', padding: '10px 13px', fontSize: 14, color: '#0f172a', background: '#f8faff', border: '1.5px solid #cbd5e1', borderRadius: 7, outline: 'none', fontFamily: 'system-ui, sans-serif' }}
                                    />
                                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                                        Any build exceeding this duration triggers a purple SLA Breach badge and Slack alert.
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
