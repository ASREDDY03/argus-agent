import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import {
    TrendBadge, StreakBadge, SlaBadge, RiskBadge,
    FlakyBadge, HealthScore, StatusDots, DurationBar,
} from '../ui/MiniComponents';

// ── TrendBadge ────────────────────────────────────────────────────────────────

describe('TrendBadge', () => {
    test('renders "Improving" label for improving trend', () => {
        const { getByText } = render(<TrendBadge trend="improving" />);
        expect(getByText(/improving/i)).toBeInTheDocument();
    });

    test('renders "Degrading" label for degrading trend', () => {
        const { getByText } = render(<TrendBadge trend="degrading" />);
        expect(getByText(/degrading/i)).toBeInTheDocument();
    });

    test('renders "Stable" label for stable trend', () => {
        const { getByText } = render(<TrendBadge trend="stable" />);
        expect(getByText(/stable/i)).toBeInTheDocument();
    });

    test('falls back to stable for unknown trend', () => {
        const { getByText } = render(<TrendBadge trend="unknown-value" />);
        expect(getByText(/stable/i)).toBeInTheDocument();
    });
});

// ── StreakBadge ───────────────────────────────────────────────────────────────

describe('StreakBadge', () => {
    test('renders nothing for count < 2', () => {
        const { container } = render(<StreakBadge count={1} />);
        expect(container.firstChild).toBeNull();
    });

    test('renders nothing for falsy count', () => {
        const { container } = render(<StreakBadge count={0} />);
        expect(container.firstChild).toBeNull();
    });

    test('renders streak label for count >= 2', () => {
        const { getByText } = render(<StreakBadge count={3} />);
        expect(getByText(/3 streak/i)).toBeInTheDocument();
    });

    test('includes count in the rendered text', () => {
        const { getByText } = render(<StreakBadge count={7} />);
        expect(getByText(/7/)).toBeInTheDocument();
    });
});

// ── SlaBadge ──────────────────────────────────────────────────────────────────

describe('SlaBadge', () => {
    test('renders nothing when breach is false', () => {
        const { container } = render(<SlaBadge breach={false} />);
        expect(container.firstChild).toBeNull();
    });

    test('renders SLA breach badge when breach is true', () => {
        const { getByText } = render(<SlaBadge breach={true} />);
        expect(getByText(/sla breach/i)).toBeInTheDocument();
    });
});

// ── RiskBadge ─────────────────────────────────────────────────────────────────

describe('RiskBadge', () => {
    test('renders nothing for LOW risk', () => {
        const { container } = render(<RiskBadge riskLevel="LOW" probability={0.1} />);
        expect(container.firstChild).toBeNull();
    });

    test('renders nothing when riskLevel is missing', () => {
        const { container } = render(<RiskBadge />);
        expect(container.firstChild).toBeNull();
    });

    test('renders HIGH RISK badge', () => {
        const { getByText } = render(<RiskBadge riskLevel="HIGH" probability={0.8} />);
        expect(getByText(/high risk/i)).toBeInTheDocument();
    });

    test('renders MEDIUM RISK badge', () => {
        const { getByText } = render(<RiskBadge riskLevel="MEDIUM" probability={0.4} />);
        expect(getByText(/medium risk/i)).toBeInTheDocument();
    });

    test('includes probability in title attribute', () => {
        const { getByTitle } = render(<RiskBadge riskLevel="HIGH" probability={0.75} />);
        expect(getByTitle(/75%/)).toBeInTheDocument();
    });
});

// ── FlakyBadge ────────────────────────────────────────────────────────────────

describe('FlakyBadge', () => {
    test('renders nothing when not flaky', () => {
        const { container } = render(<FlakyBadge flaky={false} score={0.3} />);
        expect(container.firstChild).toBeNull();
    });

    test('renders flaky badge with percentage', () => {
        const { getByText } = render(<FlakyBadge flaky={true} score={0.6} />);
        expect(getByText(/flaky/i)).toBeInTheDocument();
        expect(getByText(/60%/)).toBeInTheDocument();
    });

    test('rounds percentage correctly', () => {
        const { getByText } = render(<FlakyBadge flaky={true} score={0.333} />);
        expect(getByText(/33%/)).toBeInTheDocument();
    });
});

// ── HealthScore ───────────────────────────────────────────────────────────────

describe('HealthScore', () => {
    test('renders "—" when score is null', () => {
        const { getByText } = render(<HealthScore score={null} />);
        expect(getByText('—')).toBeInTheDocument();
    });

    test('renders the numeric score', () => {
        const { getByText } = render(<HealthScore score={72} />);
        expect(getByText('72')).toBeInTheDocument();
    });

    test('includes score in title attribute', () => {
        const { getByTitle } = render(<HealthScore score={85} />);
        expect(getByTitle(/85\/100/)).toBeInTheDocument();
    });
});

// ── StatusDots ────────────────────────────────────────────────────────────────

describe('StatusDots', () => {
    test('renders "—" for empty history', () => {
        const { getByText } = render(<StatusDots history={[]} />);
        expect(getByText('—')).toBeInTheDocument();
    });

    test('renders one dot per build (up to count limit)', () => {
        const history = Array(5).fill({ status: 'SUCCESS', duration: 30 });
        const { container } = render(<StatusDots history={history} count={5} />);
        // Each dot is a div with a borderRadius style
        const dots = container.querySelectorAll('div[style*="border-radius: 50%"]');
        expect(dots.length).toBe(5);
    });

    test('caps dots at the count prop', () => {
        const history = Array(20).fill({ status: 'SUCCESS', duration: 30 });
        const { container } = render(<StatusDots history={history} count={8} />);
        const dots = container.querySelectorAll('div[style*="border-radius: 50%"]');
        expect(dots.length).toBe(8);
    });
});

// ── DurationBar ───────────────────────────────────────────────────────────────

describe('DurationBar', () => {
    test('renders the duration value with "s" suffix', () => {
        const { getByText } = render(<DurationBar value={45} max={100} />);
        expect(getByText('45s')).toBeInTheDocument();
    });

    test('renders a filled bar with correct width percentage', () => {
        const { container } = render(<DurationBar value={50} max={100} />);
        const fill = container.querySelector('.duration-bar-fill');
        expect(fill).toHaveStyle('width: 50%');
    });

    test('caps bar width at 100% when value exceeds max', () => {
        const { container } = render(<DurationBar value={200} max={100} />);
        const fill = container.querySelector('.duration-bar-fill');
        expect(fill).toHaveStyle('width: 100%');
    });
});
