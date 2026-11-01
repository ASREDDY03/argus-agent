// ── Shared helpers ─────────────────────────────────────────────────────────────

export function statusClass(status) {
    if (status === 'SUCCESS') return 'success';
    if (status === 'FAILURE') return 'failure';
    return 'unknown';
}

export function formatTs(ts) {
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

export function computeTrends(history) {
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
