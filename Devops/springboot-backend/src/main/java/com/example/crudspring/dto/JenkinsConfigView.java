package com.example.crudspring.dto;

/**
 * Read-only view of the current Jenkins configuration returned by GET /api/jenkins/config.
 * Sensitive fields (token, Slack webhook) are masked before construction.
 */
public record JenkinsConfigView(
    String url,
    String user,
    String job,
    String token,
    boolean slackConfigured,
    String slackWebhookUrl,
    String slaDurationSeconds
) {}
