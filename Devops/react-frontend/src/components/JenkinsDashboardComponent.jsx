import React, { Component } from 'react';
import JenkinsService from '../services/JenkinsService';
import './Dashboard.css';
import { statusClass, formatTs, computeTrends } from './utils/dashboardUtils';
import {
    Sparkline, StatusDots, TrendBadge, StreakBadge, SlaBadge,
    HealthScore, RiskBadge, FlakyBadge, DurationBar, SkeletonRows,
} from './ui/MiniComponents';
import JobDrawer from './JobDrawer';
import ConfigModal from './ConfigModal';

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

        // Memoize filtered list — only recompute when jobs array or search term changes.
        // Class-component equivalent of useMemo([jobs, search]).
        if (this._filteredDeps?.[0] !== jobs || this._filteredDeps?.[1] !== search) {
            this._filtered = jobs.filter(j =>
                !search || j.jobName.toLowerCase().includes(search.toLowerCase())
            );
            this._filteredDeps = [jobs, search];
        }
        const filtered = this._filtered;

        // Memoize job stats — only recompute when the jobs array reference changes.
        if (this._statsDep !== jobs) {
            this._maxDur  = Math.max(...jobs.map(j => j.duration || 0), 1);
            this._success = jobs.filter(j => j.status === 'SUCCESS').length;
            this._failed  = jobs.filter(j => j.status === 'FAILURE').length;
            this._avgDur  = jobs.length
                ? Math.round(jobs.reduce((a, j) => a + (j.duration || 0), 0) / jobs.length)
                : 0;
            this._statsDep = jobs;
        }
        const maxDur  = this._maxDur;
        const total   = jobs.length;
        const success = this._success;
        const failed  = this._failed;
        const avgDur  = this._avgDur;

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
                    <JobDrawer
                        selectedJob={selectedJob}
                        jobDetails={jobDetails}
                        jobSummary={jobSummary}
                        jobStages={jobStages}
                        demoMode={demoMode}
                        triggeringJob={triggeringJob}
                        onClose={this.closeDrawer}
                        onTriggerBuild={this.triggerBuild}
                    />
                )}

                {/* ── Config modal ── */}
                {showConfig && (
                    <ConfigModal
                        jenkinsConfig={jenkinsConfig}
                        loading={loading}
                        onClose={() => this.setState({ showConfig: false })}
                        onConfigChange={this.handleConfigChange}
                        onSave={this.updateJenkinsConfig}
                    />
                )}
            </div>
        );
    }
}

export default JenkinsDashboardComponent;
