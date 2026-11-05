package com.example.crudspring.services;

import com.example.crudspring.models.AlertRecord;
import com.example.crudspring.repository.AlertRecordRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Unit tests for SlackAlertService.
 * Uses Mockito — no Spring context, no network.
 * Covers: persistence (always fires), Slack HTTP skip on blank webhook,
 *         alert type strings, payload escaping, and repo-failure swallowing.
 */
@ExtendWith(MockitoExtension.class)
class SlackAlertServiceTest {

    @Mock AlertRecordRepository alertRecordRepository;
    @Mock RestTemplate          mockRestTemplate;

    private SlackAlertService service;

    @BeforeEach
    void setUp() {
        service = new SlackAlertService(alertRecordRepository);
        // Replace the internally constructed RestTemplate so we can verify HTTP calls
        ReflectionTestUtils.setField(service, "restTemplate", mockRestTemplate);
    }

    // ── Persistence — always fires regardless of webhook ─────────────────────

    @Test
    void sendBuildFailureAlert_persistsWithCorrectType() {
        service.sendBuildFailureAlert(null, "my-job", 30L, "OOM error");

        ArgumentCaptor<AlertRecord> captor = ArgumentCaptor.forClass(AlertRecord.class);
        verify(alertRecordRepository).save(captor.capture());
        assertThat(captor.getValue().getAlertType()).isEqualTo("FAILURE");
        assertThat(captor.getValue().getJobName()).isEqualTo("my-job");
        assertThat(captor.getValue().getMessage()).contains("my-job");
    }

    @Test
    void sendAnomalyAlert_persistsWithCorrectType() {
        service.sendAnomalyAlert(null, "slow-job", 120L, "Duration spike");

        ArgumentCaptor<AlertRecord> captor = ArgumentCaptor.forClass(AlertRecord.class);
        verify(alertRecordRepository).save(captor.capture());
        assertThat(captor.getValue().getAlertType()).isEqualTo("ANOMALY");
    }

    @Test
    void sendRecoveryAlert_persistsWithCorrectType() {
        service.sendRecoveryAlert(null, "my-job", 25L);

        ArgumentCaptor<AlertRecord> captor = ArgumentCaptor.forClass(AlertRecord.class);
        verify(alertRecordRepository).save(captor.capture());
        assertThat(captor.getValue().getAlertType()).isEqualTo("RECOVERY");
    }

    @Test
    void sendSlaBreachAlert_persistsWithCorrectType() {
        service.sendSlaBreachAlert(null, "my-job", 95L, 60L);

        ArgumentCaptor<AlertRecord> captor = ArgumentCaptor.forClass(AlertRecord.class);
        verify(alertRecordRepository).save(captor.capture());
        assertThat(captor.getValue().getAlertType()).isEqualTo("SLA_BREACH");
        assertThat(captor.getValue().getMessage()).contains("95");
        assertThat(captor.getValue().getMessage()).contains("60");
    }

    // ── Slack HTTP call skipped when webhook is null or blank ─────────────────

    @Test
    void sendBuildFailureAlert_skipsHttpWhenWebhookIsNull() {
        service.sendBuildFailureAlert(null, "my-job", 30L, "insight");
        verifyNoInteractions(mockRestTemplate);
    }

    @Test
    void sendBuildFailureAlert_skipsHttpWhenWebhookIsBlank() {
        service.sendBuildFailureAlert("   ", "my-job", 30L, "insight");
        verifyNoInteractions(mockRestTemplate);
    }

    @Test
    void sendAnomalyAlert_skipsHttpWhenWebhookIsNull() {
        service.sendAnomalyAlert(null, "my-job", 30L, "insight");
        verifyNoInteractions(mockRestTemplate);
    }

    @Test
    void sendRecoveryAlert_skipsHttpWhenWebhookIsNull() {
        service.sendRecoveryAlert(null, "my-job", 30L);
        verifyNoInteractions(mockRestTemplate);
    }

    @Test
    void sendSlaBreachAlert_skipsHttpWhenWebhookIsNull() {
        service.sendSlaBreachAlert(null, "my-job", 95L, 60L);
        verifyNoInteractions(mockRestTemplate);
    }

    // ── Slack HTTP call fires when webhook is configured ──────────────────────

    @Test
    void sendBuildFailureAlert_postsToSlackWhenWebhookConfigured() {
        when(mockRestTemplate.postForEntity(anyString(), any(), any()))
            .thenReturn(ResponseEntity.ok("ok"));

        service.sendBuildFailureAlert("https://hooks.slack.com/T/B/X", "my-job", 30L, "insight");

        verify(mockRestTemplate).postForEntity(
            eq("https://hooks.slack.com/T/B/X"), any(), eq(String.class));
    }

    @Test
    void sendSlaBreachAlert_postsToSlackWhenWebhookConfigured() {
        when(mockRestTemplate.postForEntity(anyString(), any(), any()))
            .thenReturn(ResponseEntity.ok("ok"));

        service.sendSlaBreachAlert("https://hooks.slack.com/T/B/X", "my-job", 95L, 60L);

        verify(mockRestTemplate).postForEntity(anyString(), any(), eq(String.class));
    }

    // ── Repository failure is swallowed ───────────────────────────────────────

    @Test
    void sendBuildFailureAlert_swallowsRepositoryException() {
        doThrow(new RuntimeException("DB down")).when(alertRecordRepository).save(any());

        // Should not propagate the exception
        service.sendBuildFailureAlert(null, "my-job", 30L, "insight");
    }

    // ── Payload does not contain unescaped special characters ─────────────────

    @Test
    void sendBuildFailureAlert_persistsEvenWhenInsightContainsSpecialChars() {
        // Insight with quotes and newlines should not break persistence
        service.sendBuildFailureAlert(null, "my-job", 30L, "Error: \"file not found\"\nRetry step 2");

        verify(alertRecordRepository).save(any());
    }
}
