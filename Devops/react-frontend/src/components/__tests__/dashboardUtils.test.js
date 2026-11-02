import { statusClass, formatTs, computeTrends } from '../utils/dashboardUtils';

// ── statusClass ───────────────────────────────────────────────────────────────

describe('statusClass', () => {
    test('returns "success" for SUCCESS', () => {
        expect(statusClass('SUCCESS')).toBe('success');
    });

    test('returns "failure" for FAILURE', () => {
        expect(statusClass('FAILURE')).toBe('failure');
    });

    test('returns "unknown" for anything else', () => {
        expect(statusClass('ABORTED')).toBe('unknown');
        expect(statusClass(null)).toBe('unknown');
        expect(statusClass(undefined)).toBe('unknown');
        expect(statusClass('')).toBe('unknown');
    });
});

// ── formatTs ──────────────────────────────────────────────────────────────────

describe('formatTs', () => {
    test('returns "—" for falsy input', () => {
        expect(formatTs(null)).toBe('—');
        expect(formatTs(undefined)).toBe('—');
        expect(formatTs('')).toBe('—');
    });

    test('returns "Xs ago" for timestamps within the last minute', () => {
        const recent = new Date(Date.now() - 30 * 1000).toISOString();
        expect(formatTs(recent)).toMatch(/^\d+s ago$/);
    });

    test('returns "Xm ago" for timestamps within the last hour', () => {
        const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        expect(formatTs(recent)).toMatch(/^\d+m ago$/);
    });

    test('returns "Xh ago" for timestamps within the last day', () => {
        const recent = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
        expect(formatTs(recent)).toMatch(/^\d+h ago$/);
    });

    test('returns a locale date string for old timestamps', () => {
        const old = new Date('2020-01-01').toISOString();
        const result = formatTs(old);
        // Should be a date string, not "ago"
        expect(result).not.toMatch(/ago/);
        expect(result.length).toBeGreaterThan(0);
    });

    test('returns the raw value for unparseable input', () => {
        expect(formatTs('not-a-date')).toBe('not-a-date');
    });
});

// ── computeTrends ─────────────────────────────────────────────────────────────

describe('computeTrends', () => {
    test('returns null for empty or missing history', () => {
        expect(computeTrends(null)).toBeNull();
        expect(computeTrends([])).toBeNull();
    });

    test('computes correct successRate', () => {
        const history = [
            { status: 'SUCCESS', duration: 60, timestamp: new Date().toISOString() },
            { status: 'SUCCESS', duration: 60, timestamp: new Date().toISOString() },
            { status: 'FAILURE', duration: 60, timestamp: new Date().toISOString() },
            { status: 'FAILURE', duration: 60, timestamp: new Date().toISOString() },
        ];
        expect(computeTrends(history).successRate).toBe(50);
    });

    test('computes correct avgDuration', () => {
        const history = [
            { status: 'SUCCESS', duration: 40, timestamp: new Date().toISOString() },
            { status: 'SUCCESS', duration: 60, timestamp: new Date().toISOString() },
        ];
        expect(computeTrends(history).avgDuration).toBe(50);
    });

    test('trend is "stable" with fewer than 10 builds', () => {
        const history = Array(5).fill({ status: 'SUCCESS', duration: 30, timestamp: new Date().toISOString() });
        expect(computeTrends(history).trend).toBe('stable');
    });

    test('trend is "improving" when recent 5 outperform older 5', () => {
        const older  = Array(5).fill({ status: 'FAILURE', duration: 30, timestamp: new Date().toISOString() });
        const recent = Array(5).fill({ status: 'SUCCESS', duration: 30, timestamp: new Date().toISOString() });
        expect(computeTrends([...older, ...recent]).trend).toBe('improving');
    });

    test('trend is "degrading" when recent 5 underperform older 5', () => {
        const older  = Array(5).fill({ status: 'SUCCESS', duration: 30, timestamp: new Date().toISOString() });
        const recent = Array(5).fill({ status: 'FAILURE', duration: 30, timestamp: new Date().toISOString() });
        expect(computeTrends([...older, ...recent]).trend).toBe('degrading');
    });

    test('computes mttr when a failure is followed by a success', () => {
        const t0 = new Date('2024-01-01T12:00:00Z');
        const t1 = new Date('2024-01-01T12:10:00Z'); // 10 min later
        const history = [
            { status: 'FAILURE', duration: 30, timestamp: t0.toISOString() },
            { status: 'SUCCESS', duration: 30, timestamp: t1.toISOString() },
        ];
        expect(computeTrends(history).mttr).toBe(10);
    });

    test('mttr is null when there are no recoveries', () => {
        const history = Array(3).fill({ status: 'SUCCESS', duration: 30, timestamp: new Date().toISOString() });
        expect(computeTrends(history).mttr).toBeNull();
    });

    test('total matches history length', () => {
        const history = Array(7).fill({ status: 'SUCCESS', duration: 30, timestamp: new Date().toISOString() });
        expect(computeTrends(history).total).toBe(7);
    });
});
