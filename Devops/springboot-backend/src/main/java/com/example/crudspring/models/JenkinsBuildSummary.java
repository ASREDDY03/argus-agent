package com.example.crudspring.models;

import java.time.LocalDateTime;

public class JenkinsBuildSummary {
    private String jobName;
    private Integer buildNumber;
    private String result;
    private Boolean building;
    private String url;
    private LocalDateTime timestamp;
    private Long durationMs;
    private Long durationSeconds;
    private Long estimatedDurationMs;
    private Long queueId;
    private Long queueWaitMs;
    private Long totalTimeMs;
    private String startedBy;
    private String startedByUserId;
    private String cause;

    public JenkinsBuildSummary() {
    }

    public String getJobName() {
        return jobName;
    }

    public void setJobName(String jobName) {
        this.jobName = jobName;
    }

    public Integer getBuildNumber() {
        return buildNumber;
    }

    public void setBuildNumber(Integer buildNumber) {
        this.buildNumber = buildNumber;
    }

    public String getResult() {
        return result;
    }

    public void setResult(String result) {
        this.result = result;
    }

    public Boolean getBuilding() {
        return building;
    }

    public void setBuilding(Boolean building) {
        this.building = building;
    }

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url;
    }

    public LocalDateTime getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(LocalDateTime timestamp) {
        this.timestamp = timestamp;
    }

    public Long getDurationMs() {
        return durationMs;
    }

    public void setDurationMs(Long durationMs) {
        this.durationMs = durationMs;
    }

    public Long getDurationSeconds() {
        return durationSeconds;
    }

    public void setDurationSeconds(Long durationSeconds) {
        this.durationSeconds = durationSeconds;
    }

    public Long getEstimatedDurationMs() {
        return estimatedDurationMs;
    }

    public void setEstimatedDurationMs(Long estimatedDurationMs) {
        this.estimatedDurationMs = estimatedDurationMs;
    }

    public Long getQueueId() {
        return queueId;
    }

    public void setQueueId(Long queueId) {
        this.queueId = queueId;
    }

    public Long getQueueWaitMs() {
        return queueWaitMs;
    }

    public void setQueueWaitMs(Long queueWaitMs) {
        this.queueWaitMs = queueWaitMs;
    }

    public Long getTotalTimeMs() {
        return totalTimeMs;
    }

    public void setTotalTimeMs(Long totalTimeMs) {
        this.totalTimeMs = totalTimeMs;
    }

    public String getStartedBy() {
        return startedBy;
    }

    public void setStartedBy(String startedBy) {
        this.startedBy = startedBy;
    }

    public String getStartedByUserId() {
        return startedByUserId;
    }

    public void setStartedByUserId(String startedByUserId) {
        this.startedByUserId = startedByUserId;
    }

    public String getCause() {
        return cause;
    }

    public void setCause(String cause) {
        this.cause = cause;
    }
}
