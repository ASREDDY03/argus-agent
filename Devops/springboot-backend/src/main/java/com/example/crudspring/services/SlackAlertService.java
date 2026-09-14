package com.example.crudspring.services;

import com.example.crudspring.models.AlertRecord;
import com.example.crudspring.repository.AlertRecordRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

/**
 * Sends Slack alerts via Incoming Webhook and persists every alert to the DB.
 *
 * The webhook URL is passed per call — it comes from the client's own JenkinsConfig
 * row in the database, giving each client full isolation.
 */
@Service
public class SlackAlertService {

    private static final Logger log = LoggerFactory.getLogger(SlackAlertService.class);
    private final RestTemplate restTemplate = new RestTemplate();
    private final AlertRecordRepository alertRecordRepository;

    public SlackAlertService(AlertRecordRepository alertRecordRepository) {
        this.alertRecordRepository = alertRecordRepository;
    }

    public void sendBuildFailureAlert(String webhookUrl, String jobName, long durationSeconds, String insight) {
        String text = String.format("Build Failed — %s | Duration: %ds | %s", jobName, durationSeconds, insight);
        persist(jobName, "FAILURE", text);
        if (!isConfigured(webhookUrl)) return;
        post(webhookUrl, buildPayload("#FF0000", String.format(
            ":red_circle: *Build Failed — %s*\nDuration: %ds\n>%s", jobName, durationSeconds, insight)));
    }

    public void sendAnomalyAlert(String webhookUrl, String jobName, long durationSeconds, String insight) {
        String text = String.format("Anomaly Detected — %s | Duration: %ds | %s", jobName, durationSeconds, insight);
        persist(jobName, "ANOMALY", text);
        if (!isConfigured(webhookUrl)) return;
        post(webhookUrl, buildPayload("#FF9900", String.format(
            ":warning: *Anomaly Detected — %s*\nDuration: %ds (unusually high)\n>%s", jobName, durationSeconds, insight)));
    }

    public void sendSlaBreachAlert(String webhookUrl, String jobName, long durationSeconds, long slaSeconds) {
        if (!isConfigured(webhookUrl)) return;
        String text = String.format(
            ":stopwatch: *SLA Breach — %s*\nBuild took %ds — exceeded threshold of %ds.",
            jobName, durationSeconds, slaSeconds
        );
        post(webhookUrl, buildPayload("#9333ea", text));
    }

    public void sendRecoveryAlert(String webhookUrl, String jobName, long durationSeconds) {
        String text = String.format("Build Recovered — %s | Duration: %ds", jobName, durationSeconds);
        persist(jobName, "RECOVERY", text);
        if (!isConfigured(webhookUrl)) return;
        post(webhookUrl, buildPayload("#36A64F", String.format(
            ":large_green_circle: *Build Recovered — %s*\nDuration: %ds — back to SUCCESS.", jobName, durationSeconds)));
    }

    public void sendSlaBreachAlert(String webhookUrl, String jobName, long durationSeconds, long slaSeconds) {
        String text = String.format("SLA Breach — %s | took %ds, threshold %ds", jobName, durationSeconds, slaSeconds);
        persist(jobName, "SLA_BREACH", text);
        if (!isConfigured(webhookUrl)) return;
        post(webhookUrl, buildPayload("#9333ea", String.format(
            ":stopwatch: *SLA Breach — %s*\nBuild took %ds — exceeded threshold of %ds.", jobName, durationSeconds, slaSeconds)));
    }

    private void persist(String jobName, String alertType, String message) {
        try {
            alertRecordRepository.save(new AlertRecord(jobName, alertType, message));
        } catch (Exception e) {
            log.warn("Failed to persist alert record: {}", e.getMessage());
        }
    }

    private boolean isConfigured(String webhookUrl) {
        if (webhookUrl == null || webhookUrl.isBlank()) {
            log.debug("Slack webhook not configured for this client — skipping alert");
            return false;
        }
        return true;
    }

    private String buildPayload(String color, String text) {
        String escaped = text
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n");
        return String.format(
            "{\"attachments\":[{\"color\":\"%s\",\"text\":\"%s\",\"footer\":\"Argus Agent\"}]}",
            color, escaped
        );
    }

    private void post(String webhookUrl, String payload) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            restTemplate.postForEntity(webhookUrl, new HttpEntity<>(payload, headers), String.class);
            log.info("Slack alert sent");
        } catch (Exception e) {
            log.warn("Failed to send Slack alert: {}", e.getMessage());
        }
    }
}
