import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import JobDrawer from '../JobDrawer';

const mockJob = { jobName: 'frontend-deploy' };

const mockDetails = {
    insight: 'Build passed with no anomalies.',
    anomaly: false,
    slaBreach: false,
    failureProbability: 0.2,
    riskLevel: 'LOW',
    healthScore: 85,
    flakinessScore: 0.1,
    flaky: false,
    consecutiveFailures: 0,
    history: [
        { status: 'SUCCESS', duration: 45, timestamp: new Date().toISOString() },
        { status: 'SUCCESS', duration: 50, timestamp: new Date().toISOString() },
    ],
};

const baseProps = {
    selectedJob: mockJob,
    jobDetails: mockDetails,
    jobSummary: null,
    jobStages: null,
    demoMode: false,
    triggeringJob: null,
    onClose: jest.fn(),
    onTriggerBuild: jest.fn(),
};

beforeEach(() => {
    jest.clearAllMocks();
});

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('JobDrawer — rendering', () => {
    test('displays the job name in the header', () => {
        const { getByText } = render(<JobDrawer {...baseProps} />);
        expect(getByText('frontend-deploy')).toBeInTheDocument();
    });

    test('shows loading spinner when jobDetails is null', () => {
        const { getByText } = render(<JobDrawer {...baseProps} jobDetails={null} />);
        expect(getByText(/fetching build data/i)).toBeInTheDocument();
    });

    test('renders the AI insight text', () => {
        const { getByText } = render(<JobDrawer {...baseProps} />);
        expect(getByText('Build passed with no anomalies.')).toBeInTheDocument();
    });

    test('does not render anomaly badge when anomaly is false', () => {
        const { queryByText } = render(<JobDrawer {...baseProps} />);
        expect(queryByText(/anomaly detected/i)).not.toBeInTheDocument();
    });

    test('renders anomaly badge when anomaly is true', () => {
        const props = { ...baseProps, jobDetails: { ...mockDetails, anomaly: true } };
        const { getByText } = render(<JobDrawer {...props} />);
        expect(getByText(/anomaly detected/i)).toBeInTheDocument();
    });

    test('does not render SLA breach message when slaBreach is false', () => {
        const { queryByText } = render(<JobDrawer {...baseProps} />);
        expect(queryByText(/sla breach/i)).not.toBeInTheDocument();
    });

    test('renders SLA breach message when slaBreach is true', () => {
        const props = { ...baseProps, jobDetails: { ...mockDetails, slaBreach: true } };
        const { getAllByText } = render(<JobDrawer {...props} />);
        // Both the badge ("⏱ SLA Breach") and the description text contain "SLA"
        expect(getAllByText(/sla/i).length).toBeGreaterThan(0);
    });

    test('renders history table with correct row count', () => {
        const { getAllByRole } = render(<JobDrawer {...baseProps} />);
        // 1 header row + 2 data rows
        const rows = getAllByRole('row');
        expect(rows.length).toBe(3);
    });
});

// ── Demo mode ─────────────────────────────────────────────────────────────────

describe('JobDrawer — demo mode', () => {
    test('hides Trigger Build button in demo mode', () => {
        const { queryByText } = render(<JobDrawer {...baseProps} demoMode={true} />);
        expect(queryByText(/trigger build/i)).not.toBeInTheDocument();
    });

    test('shows Trigger Build button when not in demo mode', () => {
        const { getByText } = render(<JobDrawer {...baseProps} demoMode={false} />);
        expect(getByText(/trigger build/i)).toBeInTheDocument();
    });

    test('disables Trigger Build button while a build is triggering', () => {
        const { getByText } = render(
            <JobDrawer {...baseProps} triggeringJob="frontend-deploy" />
        );
        // Button text changes to "…" while triggering
        expect(getByText('…')).toBeInTheDocument();
    });
});

// ── Interactions ──────────────────────────────────────────────────────────────

describe('JobDrawer — interactions', () => {
    test('calls onClose when the × button is clicked', () => {
        const onClose = jest.fn();
        const { getByText } = render(<JobDrawer {...baseProps} onClose={onClose} />);
        fireEvent.click(getByText('×'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('calls onClose when the overlay is clicked', () => {
        const onClose = jest.fn();
        const { container } = render(<JobDrawer {...baseProps} onClose={onClose} />);
        const overlay = container.querySelector('.drawer-overlay');
        fireEvent.click(overlay);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('calls onTriggerBuild with job name when Trigger Build is clicked', () => {
        const onTriggerBuild = jest.fn();
        const { getByText } = render(
            <JobDrawer {...baseProps} onTriggerBuild={onTriggerBuild} />
        );
        fireEvent.click(getByText(/trigger build/i));
        expect(onTriggerBuild).toHaveBeenCalledTimes(1);
        expect(onTriggerBuild.mock.calls[0][1]).toBe('frontend-deploy');
    });
});

// ── Optional sections ─────────────────────────────────────────────────────────

describe('JobDrawer — optional sections', () => {
    test('renders build summary section when jobSummary is provided', () => {
        const summary = { buildNumber: 42, result: 'SUCCESS', durationSeconds: 55, timestamp: new Date().toISOString() };
        const { getByText } = render(<JobDrawer {...baseProps} jobSummary={summary} />);
        expect(getByText('Latest Build')).toBeInTheDocument();
        expect(getByText('#42')).toBeInTheDocument();
    });

    test('renders pipeline stages section when jobStages is provided', () => {
        const stages = [
            { name: 'Build', status: 'SUCCESS', durationSeconds: 20 },
            { name: 'Test',  status: 'SUCCESS', durationSeconds: 15 },
        ];
        const { getByText } = render(<JobDrawer {...baseProps} jobStages={stages} />);
        expect(getByText('Pipeline Stages')).toBeInTheDocument();
        expect(getByText('Build')).toBeInTheDocument();
        expect(getByText('Test')).toBeInTheDocument();
    });

    test('hides CSV export link in demo mode', () => {
        const { queryByText } = render(<JobDrawer {...baseProps} demoMode={true} />);
        expect(queryByText(/csv/i)).not.toBeInTheDocument();
    });

    test('shows CSV export link when not in demo mode', () => {
        const { getByText } = render(<JobDrawer {...baseProps} demoMode={false} />);
        expect(getByText(/csv/i)).toBeInTheDocument();
    });
});
