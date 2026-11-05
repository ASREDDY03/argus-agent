package com.example.crudspring.services;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Unit tests for ClaudeInsightService.
 * Uses Mockito — no Spring context, no network.
 * Covers: truncateLog static method, Claude API path, Ollama fallback,
 *         response parsing, and dual-failure fallback message.
 */
@ExtendWith(MockitoExtension.class)
class ClaudeInsightServiceTest {

    @Mock RestTemplate mockRestTemplate;

    private ClaudeInsightService service;

    @BeforeEach
    void setUp() {
        service = new ClaudeInsightService();
        ReflectionTestUtils.setField(service, "restTemplate", mockRestTemplate);
        ReflectionTestUtils.setField(service, "ollamaUrl", "http://localhost:11434");
        ReflectionTestUtils.setField(service, "ollamaModel", "qwen2.5-coder:14b");
    }

    // ── truncateLog (static) ──────────────────────────────────────────────────

    @Test
    void truncateLog_returnsNullForNullInput() {
        assertThat(ClaudeInsightService.truncateLog(null)).isNull();
    }

    @Test
    void truncateLog_returnsShortStringUnchanged() {
        String log = "short log";
        assertThat(ClaudeInsightService.truncateLog(log)).isEqualTo(log);
    }

    @Test
    void truncateLog_truncatesLongLogToAtMost3000Chars() {
        String longLog = "a".repeat(5000);
        String result = ClaudeInsightService.truncateLog(longLog);
        assertThat(result).isNotNull();
        assertThat(result.length()).isLessThanOrEqualTo(3000);
    }

    @Test
    void truncateLog_startsAtNewlineBoundaryWhenPossible() {
        // prefix=3000 x's + newline + suffix ensures total > 3000 and newline falls inside tail
        String prefix = "x".repeat(3000);
        String suffix = "\nline-after-newline\n" + "y".repeat(500);
        String longLog = prefix + suffix;  // total = 3520 chars
        String result = ClaudeInsightService.truncateLog(longLog);
        assertThat(result).startsWith("line-after-newline");
    }

    @Test
    void truncateLog_exactlyMaxLengthReturnedUnchanged() {
        String log = "a".repeat(3000);
        assertThat(ClaudeInsightService.truncateLog(log)).isEqualTo(log);
    }

    // ── Claude API path ───────────────────────────────────────────────────────

    @Test
    void getInsight_callsClaudeWhenApiKeyConfigured() {
        ReflectionTestUtils.setField(service, "anthropicApiKey", "sk-ant-test-key");

        String claudeBody = "{\"content\":[{\"type\":\"text\",\"text\":\"Root cause: OOM error.\"}]}";
        when(mockRestTemplate.exchange(
            eq("https://api.anthropic.com/v1/messages"), any(), any(), eq(String.class)))
            .thenReturn(ResponseEntity.ok(claudeBody));

        String result = service.getInsight("my-pipeline", 90L, true, "OutOfMemoryError");

        assertThat(result).contains("OOM error");
        verify(mockRestTemplate).exchange(
            eq("https://api.anthropic.com/v1/messages"), any(), any(), eq(String.class));
    }

    @Test
    void getInsight_parsesClaudeResponseText() {
        ReflectionTestUtils.setField(service, "anthropicApiKey", "sk-ant-test-key");

        String claudeBody = "{\"id\":\"msg_01\",\"content\":[{\"type\":\"text\","
            + "\"text\":\"Check your memory settings.\"}],\"stop_reason\":\"end_turn\"}";
        when(mockRestTemplate.exchange(anyString(), any(), any(), eq(String.class)))
            .thenReturn(ResponseEntity.ok(claudeBody));

        String result = service.getInsight("my-pipeline", 60L, false, "");

        assertThat(result).isEqualTo("Check your memory settings.");
    }

    @Test
    void getInsight_returnsParseErrorWhenClaudeBodyHasNoTextField() {
        ReflectionTestUtils.setField(service, "anthropicApiKey", "sk-ant-test-key");

        // Body exists but has no "text": field — service returns parse error directly (no Ollama fallback)
        when(mockRestTemplate.exchange(anyString(), any(), any(), eq(String.class)))
            .thenReturn(ResponseEntity.ok("{\"unexpected\":\"format\"}"));

        String result = service.getInsight("my-pipeline", 60L, true, "");

        assertThat(result).contains("Could not parse Claude response");
    }

    // ── Ollama fallback ───────────────────────────────────────────────────────

    @Test
    void getInsight_callsOllamaWhenApiKeyIsBlank() {
        ReflectionTestUtils.setField(service, "anthropicApiKey", "");

        String ollamaBody = "{\"model\":\"qwen\",\"response\":\"Check the heap size.\",\"done\":true}";
        when(mockRestTemplate.exchange(anyString(), any(), any(), eq(String.class)))
            .thenReturn(ResponseEntity.ok(ollamaBody));

        String result = service.getInsight("my-pipeline", 90L, true, "");

        assertThat(result).contains("heap size");
        verify(mockRestTemplate, never()).exchange(
            eq("https://api.anthropic.com/v1/messages"), any(), any(), eq(String.class));
    }

    @Test
    void getInsight_callsOllamaWhenApiKeyIsNull() {
        ReflectionTestUtils.setField(service, "anthropicApiKey", null);

        String ollamaBody = "{\"response\":\"Disk space issue.\",\"done\":false}";
        when(mockRestTemplate.exchange(anyString(), any(), any(), eq(String.class)))
            .thenReturn(ResponseEntity.ok(ollamaBody));

        String result = service.getInsight("my-pipeline", 90L, false, "");

        assertThat(result).contains("Disk space");
    }

    @Test
    void getInsight_parsesOllamaResponseField() {
        ReflectionTestUtils.setField(service, "anthropicApiKey", "");

        String ollamaBody = "{\"response\":\"Flaky network connection detected.\",\"done\":false}";
        when(mockRestTemplate.exchange(anyString(), any(), any(), eq(String.class)))
            .thenReturn(ResponseEntity.ok(ollamaBody));

        String result = service.getInsight("my-pipeline", 45L, false, "");

        assertThat(result).isEqualTo("Flaky network connection detected.");
    }

    @Test
    void getInsight_returnsFallbackWhenOllamaThrows() {
        ReflectionTestUtils.setField(service, "anthropicApiKey", "");

        when(mockRestTemplate.exchange(anyString(), any(), any(), eq(String.class)))
            .thenThrow(new RestClientException("Connection refused"));

        String result = service.getInsight("my-pipeline", 90L, true, "");

        assertThat(result).contains("unavailable");
        assertThat(result).contains("ANTHROPIC_API_KEY");
    }

    // ── Dual failure: Claude throws → Ollama also throws ─────────────────────

    @Test
    void getInsight_returnsFallbackWhenBothClaudeAndOllamaFail() {
        ReflectionTestUtils.setField(service, "anthropicApiKey", "sk-ant-test-key");

        when(mockRestTemplate.exchange(anyString(), any(), any(), eq(String.class)))
            .thenThrow(new RestClientException("Claude down"))  // 1st call: Claude
            .thenThrow(new RestClientException("Ollama down")); // 2nd call: Ollama

        String result = service.getInsight("my-pipeline", 90L, true, "");

        assertThat(result).isEqualTo(
            "AI insight unavailable — configure ANTHROPIC_API_KEY or start Ollama.");
    }

    @Test
    void getInsight_fallsBackToOllamaWhenClaudeThrows() {
        ReflectionTestUtils.setField(service, "anthropicApiKey", "sk-ant-test-key");

        String ollamaBody = "{\"response\":\"OOM in executor.\",\"done\":false}";
        when(mockRestTemplate.exchange(anyString(), any(), any(), eq(String.class)))
            .thenThrow(new RestClientException("Claude 429"))  // Claude fails
            .thenReturn(ResponseEntity.ok(ollamaBody));         // Ollama succeeds

        String result = service.getInsight("my-pipeline", 90L, true, "");

        assertThat(result).contains("OOM in executor");
    }
}
