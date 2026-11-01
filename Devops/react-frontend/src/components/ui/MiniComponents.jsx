import React from 'react';

// ── Mini chart / badge components ─────────────────────────────────────────────

export function Sparkline({ values, width = 120, height = 32, color = '#4361ee' }) {
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

export function StatusDots({ history, count = 12 }) {
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

export function TrendBadge({ trend }) {
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

export function StreakBadge({ count }) {
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

export function SlaBadge({ breach }) {
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

export function HealthScore({ score }) {
    if (score == null) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>;
    const color = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
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

export function RiskBadge({ riskLevel, probability }) {
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

export function FlakyBadge({ flaky, score }) {
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

export function ProbabilityBar({ probability, riskLevel }) {
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

export function StageTimeline({ stages }) {
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

export function DurationBar({ value, max }) {
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

export function SkeletonRows() {
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
