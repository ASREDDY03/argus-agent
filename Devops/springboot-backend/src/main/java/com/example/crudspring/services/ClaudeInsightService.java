package com.example.crudspring.services;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

/**
 * Calls Claude API for actionable build insights.
 * Falls back to Ollama if ANTHROPIC_API_KEY is not configured.
 */
@Service
public class ClaudeInsightService {

    private static final Logger log = LoggerFactory.getLogger(ClaudeInsightService.class);

    private static final String CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
    private static final String CLAUDE_MODEL = "claude-haiku-4-5-20251001";
    private static final int MAX_LOG_CHARS = 3000;

    @Value("${anthropic.api.key:}")
    private String anthropicApiKey;

    @Value("${ollama.url:http://host.docker.internal:11434}")
    private String ollamaUrl;

    @Value("${ollama.model:qwen2.5-coder:14b}")
    private String ollamaModel;

    private final RestTemplate restTemplate = new RestTemplate();

    /**
     * Get AI insight for an anomalous or failed build.
     *
     * @param jobName         Jenkins job name
     * @param durationSeconds actual build duration
     * @param isFailure       true if status=FAILURE, false if performance anomaly
     * @param buildLog        last N lines of Jenkins console output (may be empty)
     * @return actionable insight string
     */
    public String getInsight(String jobName, long durationSeconds, boolean isFailure, String buildLog) {
        if (isConfigured()) {
            try {
                return callClaude(jobName, durationSeconds, isFailure, buildLog);
            } catch (Exception e) {
                log.warn("[Claude] API call failed, falling back to Ollama: {}", e.getMessage());
            }
        }
        return callOllama(jobName, durationSeconds, isFailure);
    }

    private boolean isConfigured() {
        return anthropicApiKey != null && !anthropicApiKey.isBlank();
    }

    private String callClaude(String jobName, long durationSeconds, boolean isFailure, String buildLog) {
        String prompt = buildPrompt(jobName, durationSeconds, isFailure, buildLog);

        String escapedPrompt = prompt
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "");

        String requestBody = "{"
            + "\"model\":\"" + CLAUDE_MODEL + "\","
            + "\"max_tokens\":300,"
            + "\"messages\":[{\"role\":\"user\",\"content\":\"" + escapedPrompt + "\"}]"
            + "}";

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("x-api-key", anthropicApiKey);
        headers.set("anthropic-version", "2023-06-01");

        ResponseEntity<String> response = restTemplate.exchange(
            CLAUDE_API_URL, HttpMethod.POST, new HttpEntity<>(requestBody, headers), String.class
        );

        String body = response.getBody();
        if (body == null) return "Claude returned an empty response.";

        // Parse: {"content":[{"type":"text","text":"..."}],...}
        int textStart = body.indexOf("\"text\":\"") + 8;
        if (textStart < 8) return "Could not parse Claude response.";
        int textEnd = body.indexOf("\"}", textStart);
        if (textEnd < 0) textEnd = body.length() - 1;

        String insight = body.substring(textStart, textEnd)
            .replace("\\n", " ")
            .replace("\\\"", "\"")
            .trim();

        log.info("[Claude] Insight for {}: {}", jobName, insight);
        return insight;
    }

    private String callOllama(String jobName, long durationSeconds, boolean isFailure) {
        String prompt = buildPrompt(jobName, durationSeconds, isFailure, "");
        log.info("[Ollama] Falling back for job: {}", jobName);

        try {
            String escapedPrompt = prompt
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n");

            String requestBody = "{\"model\":\"" + ollamaModel
                + "\",\"prompt\":\"" + escapedPrompt + "\",\"stream\":false}";

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            ResponseEntity<String> response = restTemplate.exchange(
                ollamaUrl + "/api/generate",
                HttpMethod.POST,
                new HttpEntity<>(requestBody, headers),
                String.class
            );

            String body = response.getBody();
            if (body != null) {
                int start = body.indexOf("\"response\":\"") + 12;
                int end = body.indexOf("\",\"done\"");
                if (start > 11 && end > start) {
                    return body.substring(start, end)
                        .replace("\\n", " ")
                        .replace("\\\"", "\"")
                        .trim();
                }
            }
            return "Ollama returned an empty response.";
        } catch (Exception e) {
            log.warn("[Ollama] Error: {}", e.getMessage());
            return "AI insight unavailable — configure ANTHROPIC_API_KEY or start Ollama.";
        }
    }

    private String buildPrompt(String jobName, long durationSeconds, boolean isFailure, String buildLog) {
        StringBuilder sb = new StringBuilder();
        sb.append("You are a senior DevOps engineer. Analyze this Jenkins build and give a concise diagnosis.\n\n");
        sb.append("Job: ").append(jobName).append("\n");
        sb.append("Status: ").append(isFailure ? "FAILURE" : "SLOW BUILD (anomaly)").append("\n");
        sb.append("Duration: ").append(durationSeconds).append("s\n");

        if (buildLog != null && !buildLog.isBlank()) {
            String truncated = buildLog.length() > MAX_LOG_CHARS
                ? "...(truncated)\n" + buildLog.substring(buildLog.length() - MAX_LOG_CHARS)
                : buildLog;
            sb.append("\nBuild log (last ").append(MAX_LOG_CHARS).append(" chars):\n```\n");
            sb.append(truncated);
            sb.append("\n```\n");
        }

        sb.append("\nIn 2-3 sentences: what is the root cause and what is the specific fix? Be direct and actionable.");
        return sb.toString();
    }

    /**
     * Truncates a long log to the last MAX_LOG_CHARS characters, keeping whole lines.
     */
    public static String truncateLog(String log) {
        if (log == null || log.length() <= MAX_LOG_CHARS) return log;
        String tail = log.substring(log.length() - MAX_LOG_CHARS);
        int firstNewline = tail.indexOf('\n');
        return firstNewline > 0 ? tail.substring(firstNewline + 1) : tail;
    }
}
