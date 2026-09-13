package com.example.crudspring.models;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;

@Entity
@Table(name = "alert_history")
public class AlertRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "job_name", nullable = false)
    private String jobName;

    @Column(name = "alert_type", nullable = false)
    private String alertType; // FAILURE | ANOMALY | RECOVERY | SLA_BREACH

    @Column(nullable = false, length = 1000)
    private String message;

    @Column(nullable = false)
    private LocalDateTime timestamp;

    public AlertRecord() {}

    public AlertRecord(String jobName, String alertType, String message) {
        this.jobName   = jobName;
        this.alertType = alertType;
        this.message   = message;
        this.timestamp = LocalDateTime.now();
    }

    public Long getId()                 { return id; }
    public String getJobName()          { return jobName; }
    public String getAlertType()        { return alertType; }
    public String getMessage()          { return message; }
    public LocalDateTime getTimestamp() { return timestamp; }
}
