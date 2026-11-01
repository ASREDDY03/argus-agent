package com.example.crudspring.services;

import com.example.crudspring.dto.JenkinsConfigView;
import com.example.crudspring.dto.JobInsightsResponse;
import com.example.crudspring.dto.StatusResponse;
import com.example.crudspring.models.BuildRecord;
import com.example.crudspring.models.JenkinsJob;
import com.example.crudspring.repository.BuildRecordRepository;
import com.example.crudspring.repository.JenkinsConfigRepository;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * Unit tests for JenkinsService.
 * Uses Mockito — no Spring context, no database, no network.
 * Covers: computeFlakiness, computeHealthScore, config masking,
 *         URL validation, ML circuit breaker, alert cooldown, CSV export.
 */
@ExtendWith(MockitoExtension.class)
class JenkinsServiceTest {

    // SimpleMeterRegistry is Micrometer's in-memory impl — Mockito cannot mock MeterRegistry on Java 25
    private final SimpleMeterRegistry meterRegistry = new SimpleMeterRegistry();

    @Mock SlackAlertService       slackAlertService;
    @Mock ClaudeInsightService    claudeInsightService;
    @Mock JenkinsConfigRepository configRepository;
    @Mock BuildRecordRepository   buildRecordRepository;

    // Constructed manually so we can inject the real SimpleMeterRegistry
    private JenkinsService service;

    @BeforeEach
    void setUp() {
        service = new JenkinsService(meterRegistry, slackAlertService, claudeInsightService,
                configRepository, buildRecordRepository);
        // Inject @Value fields — Spring doesn't wire these in a plain unit test
        ReflectionTestUtils.setField(service, "defaultJenkinsUrl",   "http://localhost:8080");
        ReflectionTestUtils.setField(service, "defaultJobName",      "test-job");
        ReflectionTestUtils.setField(service, "defaultJenkinsUser",  "admin");
        ReflectionTestUtils.setField(service, "defaultJenkinsToken", "token1234abcd");
        ReflectionTestUtils.setField(service, "mlServiceUrl",        "http://ml-service:8000/analyze");
        // No saved config in DB → falls back to env defaults
        when(configRepository.findTopByOrderByIdDesc()).thenReturn(Optional.empty());
        service.initializeDefaults();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Build a JenkinsJob list from a vararg of status strings. */
    private List<JenkinsJob> history(String... statuses) {
        return Arrays.stream(statuses)
                .map(s -> new JenkinsJob("job", s, LocalDateTime.now(), 30L))
                .collect(Collectors.toList());
    }

    private double flakiness(List<JenkinsJob> h) {
        return (double) ReflectionTestUtils.invokeMethod(service, "computeFlakiness", h);
    }

    private int healthScore(List<JenkinsJob> h, int streak, String risk) {
        return (int) ReflectionTestUtils.invokeMethod(service, "computeHealthScore", h, streak, risk);
    }

    private boolean circuitOpen() {
        return (boolean) ReflectionTestUtils.invokeMethod(service, "mlCircuitOpen");
    }

    private boolean canAlert(String job) {
        return (boolean) ReflectionTestUtils.invokeMethod(service, "canAlert", job);
    }

    // ── computeFlakiness ──────────────────────────────────────────────────────

    @Test
    void computeFlakiness_emptyList_returnsZero() {
        assertThat(flakiness(List.of())).isEqualTo(0.0);
    }

    @Test
    void computeFlakiness_twoBuilds_returnsZero() {
        // Requires ≥ 3 builds; 2 builds is below the threshold
        assertThat(flakiness(history("SUCCESS", "FAILURE"))).isEqualTo(0.0);
    }

    @Test
    void computeFlakiness_allSameStatus_returnsZero() {
        assertThat(flakiness(history("SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"))).isEqualTo(0.0);
    }

    @Test
    void computeFlakiness_fullyAlternating_returnsOne() {
        // S F S F → 3 flips / 3 pairs = 1.0
        assertThat(flakiness(history("SUCCESS", "FAILURE", "SUCCESS", "FAILURE"))).isEqualTo(1.0);
    }

    @Test
    void computeFlakiness_partialFlips_returnsRoundedFraction() {
        // S S F F S → (S→S no, S→F yes, F→F no, F→S yes) = 2 flips / 4 pairs = 0.5
        assertThat(flakiness(history("SUCCESS", "SUCCESS", "FAILURE", "FAILURE", "SUCCESS")))
                .isEqualTo(0.5);
    }

    // ── computeHealthScore ────────────────────────────────────────────────────

    @Test
    void computeHealthScore_emptyHistory_returnsFifty() {
        assertThat(healthScore(List.of(), 0, "LOW")).isEqualTo(50);
    }

    @Test
    void computeHealthScore_allSuccess_noStreak_lowRisk_returnsNinety() {
        // srPts=40, trendPts=10 (default, <10 builds), streakPts=20, riskPts=20 → 90
        assertThat(healthScore(history("SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"), 0, "LOW"))
                .isEqualTo(90);
    }

    @Test
    void computeHealthScore_streakFour_reducesStreakPoints() {
        // streak=4 → streakPts = max(0, 20 - 4*5) = 0 → total = 40+10+0+20 = 70
        assertThat(healthScore(history("SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"), 4, "LOW"))
                .isEqualTo(70);
    }

    @Test
    void computeHealthScore_highRisk_reducesRiskPoints() {
        // HIGH riskPts=0 → total = 40+10+20+0 = 70
        assertThat(healthScore(history("SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"), 0, "HIGH"))
                .isEqualTo(70);
    }

    @Test
    void computeHealthScore_improvingTrend_boostsTrendPoints() {
        // 10 builds: first 5 FAILURE, last 5 SUCCESS → improving
        // srPts=20, trendPts=20, streakPts=20, riskPts=20 → 80
        List<JenkinsJob> h = new ArrayList<>(history(
                "FAILURE", "FAILURE", "FAILURE", "FAILURE", "FAILURE",
                "SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"
        ));
        assertThat(healthScore(h, 0, "LOW")).isEqualTo(80);
    }

    @Test
    void computeHealthScore_degradingTrend_zeroesTrendPoints() {
        // 10 builds: first 5 SUCCESS, last 5 FAILURE → degrading
        // srPts=20, trendPts=0, streakPts=20, riskPts=20 → 60
        List<JenkinsJob> h = new ArrayList<>(history(
                "SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS",
                "FAILURE", "FAILURE", "FAILURE", "FAILURE", "FAILURE"
        ));
        assertThat(healthScore(h, 0, "LOW")).isEqualTo(60);
    }

    // ── getJenkinsConfig — token and Slack masking ────────────────────────────

    @Test
    void getJenkinsConfig_longToken_isMaskedWithLastFour() {
        ReflectionTestUtils.setField(service, "jenkinsToken", "abcdefgh5678");
        JenkinsConfigView cfg = service.getJenkinsConfig();
        assertThat(cfg.token()).startsWith("***");
        assertThat(cfg.token()).endsWith("5678");
    }

    @Test
    void getJenkinsConfig_shortToken_returnsEmpty() {
        ReflectionTestUtils.setField(service, "jenkinsToken", "abc"); // length ≤ 4
        assertThat(service.getJenkinsConfig().token()).isEmpty();
    }

    @Test
    void getJenkinsConfig_placeholderToken_returnsEmpty() {
        ReflectionTestUtils.setField(service, "jenkinsToken", "your-jenkins-token-here");
        assertThat(service.getJenkinsConfig().token()).isEmpty();
    }

    @Test
    void getJenkinsConfig_slackConfigured_isObfuscated() {
        ReflectionTestUtils.setField(service, "slackWebhookUrl", "https://hooks.slack.com/services/xxx");
        JenkinsConfigView cfg = service.getJenkinsConfig();
        assertThat(cfg.slackConfigured()).isTrue();
        assertThat(cfg.slackWebhookUrl()).isEqualTo("***configured***");
    }

    @Test
    void getJenkinsConfig_slackBlank_notConfigured() {
        ReflectionTestUtils.setField(service, "slackWebhookUrl", "");
        JenkinsConfigView cfg = service.getJenkinsConfig();
        assertThat(cfg.slackConfigured()).isFalse();
    }

    @Test
    void getJenkinsConfig_slaSet_returnsSlaAsString() {
        ReflectionTestUtils.setField(service, "slaDurationSeconds", 300L);
        assertThat(service.getJenkinsConfig().slaDurationSeconds()).isEqualTo("300");
    }

    @Test
    void getJenkinsConfig_slaNull_returnsEmpty() {
        ReflectionTestUtils.setField(service, "slaDurationSeconds", null);
        assertThat(service.getJenkinsConfig().slaDurationSeconds()).isEmpty();
    }

    // ── updateJenkinsConfig — URL validation ──────────────────────────────────

    @Test
    void updateJenkinsConfig_nullUrl_returnsError() {
        Map<String, String> config = new HashMap<>();
        config.put("url", null);
        StatusResponse result = service.updateJenkinsConfig(config);
        assertThat(result.status()).isEqualTo("error");
        assertThat(result.message()).contains("Invalid Jenkins URL");
    }

    @Test
    void updateJenkinsConfig_ftpProtocol_returnsError() {
        StatusResponse result = service.updateJenkinsConfig(Map.of("url", "ftp://example.com"));
        assertThat(result.status()).isEqualTo("error");
        assertThat(result.message()).contains("Invalid Jenkins URL");
    }

    @Test
    void updateJenkinsConfig_noProtocol_returnsError() {
        StatusResponse result = service.updateJenkinsConfig(Map.of("url", "example.com:8080"));
        assertThat(result.status()).isEqualTo("error");
    }

    // ── getMockJobs ───────────────────────────────────────────────────────────

    @Test
    void getMockJobs_returnsThreeNamedJobs() {
        List<JenkinsJob> jobs = service.getMockJobs();
        assertThat(jobs).hasSize(3);
        assertThat(jobs).extracting(JenkinsJob::getJobName)
                .containsExactlyInAnyOrder("frontend-deploy", "backend-api", "ml-pipeline");
    }

    @Test
    void getMockJobs_backendApi_isHighRiskAndFlaky() {
        JenkinsJob backend = service.getMockJobs().stream()
                .filter(j -> "backend-api".equals(j.getJobName()))
                .findFirst().orElseThrow();
        assertThat(backend.getStatus()).isEqualTo("FAILURE");
        assertThat(backend.getRiskLevel()).isEqualTo("HIGH");
        assertThat(backend.getFlaky()).isTrue();
        assertThat(backend.getConsecutiveFailures()).isEqualTo(2);
    }

    @Test
    void getMockJobs_mlPipeline_isHealthy() {
        JenkinsJob ml = service.getMockJobs().stream()
                .filter(j -> "ml-pipeline".equals(j.getJobName()))
                .findFirst().orElseThrow();
        assertThat(ml.getStatus()).isEqualTo("SUCCESS");
        assertThat(ml.getRiskLevel()).isEqualTo("LOW");
        assertThat(ml.getFlaky()).isFalse();
        assertThat(ml.getHealthScore()).isGreaterThan(80);
    }

    // ── getMockJobInsights ────────────────────────────────────────────────────

    @Test
    void getMockJobInsights_frontendDeploy_anomalyWithMediumRisk() {
        JobInsightsResponse r = service.getMockJobInsights("frontend-deploy");
        assertThat(r.anomaly()).isTrue();
        assertThat(r.riskLevel()).isEqualTo("MEDIUM");
        assertThat(r.consecutiveFailures()).isEqualTo(0);
        assertThat(r.flaky()).isFalse();
        assertThat(r.history()).hasSize(5);
    }

    @Test
    void getMockJobInsights_backendApi_highRiskFlaky() {
        JobInsightsResponse r = service.getMockJobInsights("backend-api");
        assertThat(r.riskLevel()).isEqualTo("HIGH");
        assertThat(r.flaky()).isTrue();
        assertThat(r.flakinessScore()).isEqualTo(0.5);
        assertThat(r.consecutiveFailures()).isEqualTo(2);
        assertThat(r.failureProbability()).isGreaterThan(0.8);
    }

    @Test
    void getMockJobInsights_mlPipeline_healthyLowRisk() {
        JobInsightsResponse r = service.getMockJobInsights("ml-pipeline");
        assertThat(r.anomaly()).isFalse();
        assertThat(r.riskLevel()).isEqualTo("LOW");
        assertThat(r.failureProbability()).isLessThan(0.1);
        assertThat(r.healthScore()).isGreaterThanOrEqualTo(80);
    }

    @Test
    void getMockJobInsights_unknownJob_returnsFallbackInsight() {
        JobInsightsResponse r = service.getMockJobInsights("not-a-real-job");
        assertThat(r.insight()).contains("No mock data");
        assertThat(r.riskLevel()).isEqualTo("LOW");
        assertThat(r.failureProbability()).isEqualTo(0.0);
    }

    // ── ML circuit breaker ────────────────────────────────────────────────────

    @Test
    void mlCircuit_initialState_isClosed() {
        assertThat(circuitOpen()).isFalse();
    }

    @Test
    void mlCircuit_twoFailures_remainsClosed() {
        ReflectionTestUtils.invokeMethod(service, "mlCallFailed");
        ReflectionTestUtils.invokeMethod(service, "mlCallFailed");
        assertThat(circuitOpen()).isFalse(); // threshold is 3
    }

    @Test
    void mlCircuit_threeFailures_opensCircuit() {
        ReflectionTestUtils.invokeMethod(service, "mlCallFailed");
        ReflectionTestUtils.invokeMethod(service, "mlCallFailed");
        ReflectionTestUtils.invokeMethod(service, "mlCallFailed");
        assertThat(circuitOpen()).isTrue();
    }

    @Test
    void mlCircuit_successResets_closesCircuit() {
        ReflectionTestUtils.invokeMethod(service, "mlCallFailed");
        ReflectionTestUtils.invokeMethod(service, "mlCallFailed");
        ReflectionTestUtils.invokeMethod(service, "mlCallSucceeded");
        AtomicInteger count = (AtomicInteger) ReflectionTestUtils.getField(service, "mlFailureCount");
        assertThat(count.get()).isEqualTo(0);
        assertThat(circuitOpen()).isFalse();
    }

    @Test
    void mlCircuit_afterResetWindow_allowsHalfOpenProbe() {
        // Drive the circuit open
        ReflectionTestUtils.invokeMethod(service, "mlCallFailed");
        ReflectionTestUtils.invokeMethod(service, "mlCallFailed");
        ReflectionTestUtils.invokeMethod(service, "mlCallFailed");
        assertThat(circuitOpen()).isTrue();
        // Backdate the open timestamp beyond the 30s reset window
        ReflectionTestUtils.setField(service, "mlCircuitOpenedAt", System.currentTimeMillis() - 31_000L);
        assertThat(circuitOpen()).isFalse(); // HALF-OPEN: one probe allowed
    }

    // ── Alert cooldown ────────────────────────────────────────────────────────

    @Test
    void canAlert_noHistory_returnsTrue() {
        assertThat(canAlert("new-job")).isTrue();
    }

    @Test
    void canAlert_withinCooldown_returnsFalse() {
        ReflectionTestUtils.invokeMethod(service, "markAlerted", "job-a");
        assertThat(canAlert("job-a")).isFalse();
    }

    @Test
    void canAlert_afterCooldownExpired_returnsTrue() {
        @SuppressWarnings("unchecked")
        Map<String, Long> lastAlertTime = (Map<String, Long>) ReflectionTestUtils.getField(service, "lastAlertTime");
        lastAlertTime.put("job-a", System.currentTimeMillis() - 11 * 60 * 1_000L); // 11 min ago
        assertThat(canAlert("job-a")).isTrue();
    }

    // ── exportBuildHistoryCsv ─────────────────────────────────────────────────

    @Test
    void exportBuildHistoryCsv_noRecords_returnsCsvHeaderOnly() {
        when(buildRecordRepository.findByJobNameOrderByTimestampAsc("job-z")).thenReturn(List.of());
        String csv = service.exportBuildHistoryCsv("job-z");
        assertThat(csv).isEqualTo("build_number,status,duration_seconds,timestamp\n");
    }

    @Test
    void exportBuildHistoryCsv_withRecord_includesAllFields() {
        LocalDateTime ts = LocalDateTime.of(2024, 6, 1, 12, 0);
        BuildRecord record = new BuildRecord("job-z", 42, "SUCCESS", 30L, ts);
        when(buildRecordRepository.findByJobNameOrderByTimestampAsc("job-z")).thenReturn(List.of(record));
        String csv = service.exportBuildHistoryCsv("job-z");
        assertThat(csv).contains("42,SUCCESS,30,");
        assertThat(csv).contains(ts.toString());
    }

    @Test
    void exportBuildHistoryCsv_multipleRecords_outputsOneRowEach() {
        LocalDateTime ts = LocalDateTime.of(2024, 6, 1, 12, 0);
        List<BuildRecord> records = List.of(
                new BuildRecord("job-z", 1, "SUCCESS", 20L, ts),
                new BuildRecord("job-z", 2, "FAILURE", 10L, ts.plusHours(1)),
                new BuildRecord("job-z", 3, "SUCCESS", 25L, ts.plusHours(2))
        );
        when(buildRecordRepository.findByJobNameOrderByTimestampAsc("job-z")).thenReturn(records);
        String csv = service.exportBuildHistoryCsv("job-z");
        long dataRows = csv.lines().filter(l -> !l.startsWith("build_number")).count();
        assertThat(dataRows).isEqualTo(3);
    }
}
