package com.example.crudspring.services;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
public class SlackAlertService {

    private static final Logger log = LoggerFactory.getLogger(SlackAlertService.class);

    @Value("${slack.webhook.url:}")
    private String webhookUrl;

    private final RestTemplate restTemplate = new RestTemplate();

    public void sendBuildFailureAlert(String jobName, long durationSeconds, String insight) {
        if (!isConfigured()) return;
        String text = String.format(
            ":red_circle: *Build Failed — %s*\nDuration: %ds\n>%s",
            jobName, durationSeconds, insight
        );
        post(buildPayload("#FF0000", text));
    }

    public void sendAnomalyAlert(String jobName, long durationSeconds, String insight) {
        if (!isConfigured()) return;
        String text = String.format(
            ":warning: *Anomaly Detected — %s*\nDuration: %ds (unusually high)\n>%s",
            jobName, durationSeconds, insight
        );
        post(buildPayload("#FF9900", text));
    }

    public void sendRecoveryAlert(String jobName, long durationSeconds) {
        if (!isConfigured()) return;
        String text = String.format(
            ":large_green_circle: *Build Recovered — %s*\nDuration: %ds — back to SUCCESS.",
            jobName, durationSeconds
        );
        post(buildPayload("#36A64F", text));
    }

    private boolean isConfigured() {
        if (webhookUrl == null || webhookUrl.isBlank()) {
            log.debug("Slack webhook not configured — skipping alert");
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

    private void post(String payload) {
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
