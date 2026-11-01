import React from 'react';
import { formatTs, statusClass, computeTrends } from './utils/dashboardUtils';
import {
    Sparkline, StatusDots, TrendBadge, StreakBadge, SlaBadge,
    HealthScore, RiskBadge, FlakyBadge, ProbabilityBar, StageTimeline,
} from './ui/MiniComponents';

export default function JobDrawer({
    selectedJob, jobDetails, jobSummary, jobStages,
    demoMode, triggeringJob,
    onClose, onTriggerBuild,
}) {
    const drawerTrends = jobDetails ? computeTrends(jobDetails.history || []) : null;

    return (
        <>
            <div className="drawer-overlay" onClick={onClose} />
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
                                onClick={e => onTriggerBuild(e, selectedJob.jobName)}
                                disabled={triggeringJob === selectedJob?.jobName}
                            >
                                {triggeringJob === selectedJob?.jobName ? '…' : '▶ Trigger Build'}
                            </button>
                        )}
                        <button className="close-btn" onClick={onClose}>×</button>
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
    );
}
