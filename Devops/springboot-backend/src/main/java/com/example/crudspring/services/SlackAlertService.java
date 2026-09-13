package com.example.crudspring.services;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

/**
 * Sends Slack alerts via Incoming Webhook.
 *
 * The webhook URL is passed per call — it comes from the client's own JenkinsConfig
 * row in the database, giving each client full isolation (their alerts go to their
 * channel, not a shared one).
 */
@Service
public class SlackAlertService {

    private static final Logger log = LoggerFactory.getLogger(SlackAlertService.class);
    private final RestTemplate restTemplate = new RestTemplate();

    public void sendBuildFailureAlert(String webhookUrl, String jobName, long durationSeconds, String insight) {
        if (!isConfigured(webhookUrl)) return;
        String text = String.format(
            ":red_circle: *Build Failed — %s*\nDuration: %ds\n>%s",
            jobName, durationSeconds, insight
        );
        post(webhookUrl, buildPayload("#FF0000", text));
    }

    public void sendAnomalyAlert(String webhookUrl, String jobName, long durationSeconds, String insight) {
        if (!isConfigured(webhookUrl)) return;
        String text = String.format(
            ":warning: *Anomaly Detected — %s*\nDuration: %ds (unusually high)\n>%s",
            jobName, durationSeconds, insight
        );
        post(webhookUrl, buildPayload("#FF9900", text));
    }

    public void sendRecoveryAlert(String webhookUrl, String jobName, long durationSeconds) {
        if (!isConfigured(webhookUrl)) return;
        String text = String.format(
            ":large_green_circle: *Build Recovered — %s*\nDuration: %ds — back to SUCCESS.",
            jobName, durationSeconds
        );
        post(webhookUrl, buildPayload("#36A64F", text));
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
