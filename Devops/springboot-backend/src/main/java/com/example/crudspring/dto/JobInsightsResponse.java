package com.example.crudspring.dto;

import com.example.crudspring.models.JenkinsJob;
import java.util.List;

/**
 * Typed response for /api/jobs/{jobName} (getJobInsights).
 * Replaces the previous Map&lt;String, Object&gt; return.
 */
public record JobInsightsResponse(
    List<JenkinsJob> history,
    boolean slaBreach,
    int consecutiveFailures,
    boolean anomaly,
    String insight,
    double failureProbability,
    String riskLevel,
    double flakinessScore,
    boolean flaky,
    int healthScore
) {}
