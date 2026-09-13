package com.example.crudspring.models;

import java.time.LocalDateTime;

public class JenkinsJob {
    private String jobName;
    private String status;
    private LocalDateTime timestamp;
    private Long duration;

    // Populated by background monitor — baked into every WebSocket broadcast
    private Boolean anomaly;
    private String riskLevel;
    private Double failureProbability;
    private Double flakinessScore; // 0.0–1.0: fraction of consecutive build pairs that flipped status
    private Boolean flaky;         // true when flakinessScore > 0.4
    private Integer consecutiveFailures;

    public JenkinsJob() {}

    public JenkinsJob(String jobName, String status, LocalDateTime timestamp, Long duration) {
        this.jobName = jobName;
        this.status = status;
        this.timestamp = timestamp;
        this.duration = duration;
    }

    public String getJobName() { return jobName; }
    public void setJobName(String jobName) { this.jobName = jobName; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public LocalDateTime getTimestamp() { return timestamp; }
    public void setTimestamp(LocalDateTime timestamp) { this.timestamp = timestamp; }
    public Long getDuration() { return duration; }
    public void setDuration(Long duration) { this.duration = duration; }
    public Boolean getAnomaly() { return anomaly; }
    public void setAnomaly(Boolean anomaly) { this.anomaly = anomaly; }
    public String getRiskLevel() { return riskLevel; }
    public void setRiskLevel(String riskLevel) { this.riskLevel = riskLevel; }
    public Double getFailureProbability() { return failureProbability; }
    public void setFailureProbability(Double failureProbability) { this.failureProbability = failureProbability; }
    public Double getFlakinessScore() { return flakinessScore; }
    public void setFlakinessScore(Double flakinessScore) { this.flakinessScore = flakinessScore; }
    public Boolean getFlaky() { return flaky; }
    public void setFlaky(Boolean flaky) { this.flaky = flaky; }
    public Integer getConsecutiveFailures() { return consecutiveFailures; }
    public void setConsecutiveFailures(Integer consecutiveFailures) { this.consecutiveFailures = consecutiveFailures; }
} 