package com.example.crudspring.models;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.LocalDateTime;

@Entity
@Table(
    name = "build_history",
    uniqueConstraints = @UniqueConstraint(columnNames = {"job_name", "build_number"})
)
public class BuildRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "job_name", nullable = false)
    private String jobName;

    @Column(name = "build_number", nullable = false)
    private Integer buildNumber;

    @Column(nullable = false)
    private String status;

    @Column(nullable = false)
    private Long durationSeconds;

    @Column(nullable = false)
    private LocalDateTime timestamp;

    public BuildRecord() {}

    public BuildRecord(String jobName, Integer buildNumber, String status,
                       Long durationSeconds, LocalDateTime timestamp) {
        this.jobName         = jobName;
        this.buildNumber     = buildNumber;
        this.status          = status;
        this.durationSeconds = durationSeconds;
        this.timestamp       = timestamp;
    }

    public Long getId()                  { return id; }
    public String getJobName()           { return jobName; }
    public Integer getBuildNumber()      { return buildNumber; }
    public String getStatus()            { return status; }
    public Long getDurationSeconds()     { return durationSeconds; }
    public LocalDateTime getTimestamp()  { return timestamp; }
}
