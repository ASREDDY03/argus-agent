package com.example.crudspring.services;

import com.example.crudspring.models.BuildRecord;
import com.example.crudspring.models.JenkinsConfig;
import com.example.crudspring.models.JenkinsJob;
import com.example.crudspring.models.JenkinsBuildSummary;
import com.example.crudspring.repository.BuildRecordRepository;
import com.example.crudspring.repository.JenkinsConfigRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import jakarta.annotation.PostConstruct;
import org.springframework.web.client.RestTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.HttpMethod;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Tags;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.util.UriComponentsBuilder;

@Service
public class JenkinsService {

    private static final Logger log = LoggerFactory.getLogger(JenkinsService.class);
    @Value("${jenkins.url}")
    private String defaultJenkinsUrl;

    @Value("${jenkins.job}")
    private String defaultJobName;

    @Value("${jenkins.user}")
    private String defaultJenkinsUser;

    @Value("${jenkins.token}")
    private String defaultJenkinsToken;

    // Dynamic configuration - can be updated via API and persisted per client
    private String jenkinsUrl;
    private String jobName;
    private String jenkinsUser;
    private String jenkinsToken;
    private String slackWebhookUrl;     // per-client, stored in DB
    private Long   slaDurationSeconds;  // 0 / null = disabled

    @Value("${ml.service.url}")
    private String mlServiceUrl;

    private final RestTemplate restTemplate = new RestTemplate();

    private final MeterRegistry meterRegistry;
    private final SlackAlertService slackAlertService;
    private final ClaudeInsightService claudeInsightService;
    private final JenkinsConfigRepository configRepository;
    private final BuildRecordRepository buildRecordRepository;

    // Tracks last known status per job for recovery detection
    private final Map<String, String> lastKnownStatus = new ConcurrentHashMap<>();

    // Alert cooldown — suppress repeated Slack alerts for the same job (10 min)
    private static final long ALERT_COOLDOWN_MS = 10 * 60 * 1000L;
    private final Map<String, Long> lastAlertTime = new ConcurrentHashMap<>();

    // Latest insights per job — populated by background monitor, merged into WebSocket broadcasts
    private final Map<String, Map<String, Object>> insightsCache = new ConcurrentHashMap<>();

    /**
     * Flakiness = fraction of consecutive build pairs that flipped status (0.0–1.0).
     * Requires ≥3 builds; returns 0.0 otherwise.
     * Example: S F S F S → 4 flips / 4 pairs = 1.0 (maximally flaky)
     */
    private double computeFlakiness(List<JenkinsJob> history) {
        if (history.size() < 3) return 0.0;
        int flips = 0;
        for (int i = 1; i < history.size(); i++) {
            String prev = history.get(i - 1).getStatus();
            String curr = history.get(i).getStatus();
            if (prev != null && !prev.equalsIgnoreCase(curr)) flips++;
        }
        return Math.round((double) flips / (history.size() - 1) * 100.0) / 100.0;
    }

    /**
     * Composite health score 0–100.
     * Success rate (40 pts) + trend (20 pts) + streak penalty (20 pts) + risk (20 pts).
     */
    private int computeHealthScore(List<JenkinsJob> history, int streak, String riskLevel) {
        if (history.isEmpty()) return 50;
        int total     = history.size();
        int successes = (int) history.stream().filter(j -> "SUCCESS".equalsIgnoreCase(j.getStatus())).count();

        // 40 pts: success rate
        int srPts = (int) Math.round((double) successes / total * 40);

        // 20 pts: trend — compare last 5 vs previous 5
        int trendPts = 10; // stable default
        if (total >= 10) {
            long recentOk = history.subList(total - 5, total).stream().filter(j -> "SUCCESS".equalsIgnoreCase(j.getStatus())).count();
            long olderOk  = history.subList(total - 10, total - 5).stream().filter(j -> "SUCCESS".equalsIgnoreCase(j.getStatus())).count();
            if (recentOk > olderOk)      trendPts = 20;
            else if (recentOk < olderOk) trendPts = 0;
        }

        // 20 pts: streak (lose 5 per consecutive failure)
        int streakPts = Math.max(0, 20 - streak * 5);

        // 20 pts: ML risk level
        int riskPts = "HIGH".equals(riskLevel) ? 0 : "MEDIUM".equals(riskLevel) ? 10 : 20;

        return Math.min(100, srPts + trendPts + streakPts + riskPts);
    }

    private boolean canAlert(String jobName) {
        long now = System.currentTimeMillis();
        Long last = lastAlertTime.get(jobName);
        return last == null || (now - last) >= ALERT_COOLDOWN_MS;
    }

    private void markAlerted(String jobName) {
        lastAlertTime.put(jobName, System.currentTimeMillis());
    }

    /** Counts how many of the most recent builds are consecutive FAILURE, reading from DB. */
    private int computeConsecutiveFailures(String jobName) {
        List<com.example.crudspring.models.BuildRecord> recent =
            buildRecordRepository.findTop20ByJobNameOrderByTimestampDesc(jobName);
        int streak = 0;
        for (com.example.crudspring.models.BuildRecord r : recent) {
            if ("FAILURE".equalsIgnoreCase(r.getStatus())) streak++;
            else break;
        }
        return streak;
    }

    public JenkinsService(MeterRegistry meterRegistry, SlackAlertService slackAlertService,
                          ClaudeInsightService claudeInsightService,
                          JenkinsConfigRepository configRepository,
                          BuildRecordRepository buildRecordRepository) {
        this.meterRegistry = meterRegistry;
        this.slackAlertService = slackAlertService;
        this.claudeInsightService = claudeInsightService;
        this.configRepository = configRepository;
        this.buildRecordRepository = buildRecordRepository;
    }

    @PostConstruct
    void initializeDefaults() {
        // Load persisted config from DB first; fall back to env/application.properties values
        configRepository.findTopByOrderByIdDesc().ifPresentOrElse(saved -> {
            this.jenkinsUrl      = saved.getUrl();
            this.jobName         = saved.getJob();
            this.jenkinsUser     = saved.getUser();
            this.jenkinsToken    = saved.getToken();
            this.slackWebhookUrl    = saved.getSlackWebhookUrl();
            this.slaDurationSeconds = saved.getSlaDurationSeconds();
            log.info("[CONFIG] Loaded Jenkins config from database");
        }, () -> {
            this.jenkinsUrl   = this.defaultJenkinsUrl;
            this.jobName      = this.defaultJobName;
            this.jenkinsUser  = this.defaultJenkinsUser;
            this.jenkinsToken = this.defaultJenkinsToken;
            log.info("[CONFIG] Using default Jenkins config from environment");
        });
    }

    public Map<String, Object> updateJenkinsConfig(Map<String, String> config) {
        Map<String, Object> result = new HashMap<>();
        try {
            if (config.containsKey("url"))              this.jenkinsUrl      = config.get("url");
            if (config.containsKey("user"))             this.jenkinsUser     = config.get("user");
            if (config.containsKey("token"))            this.jenkinsToken    = config.get("token");
            if (config.containsKey("job"))              this.jobName         = config.get("job");
            if (config.containsKey("slackWebhookUrl"))  this.slackWebhookUrl = config.get("slackWebhookUrl");
            if (config.containsKey("slaDurationSeconds") && !config.get("slaDurationSeconds").isBlank()) {
                try { this.slaDurationSeconds = Long.parseLong(config.get("slaDurationSeconds")); }
                catch (NumberFormatException ignored) {}
            } else if (config.containsKey("slaDurationSeconds")) {
                this.slaDurationSeconds = null; // blank = disabled
            }

            // Test the connection with new credentials
            List<JenkinsJob> jobs = getAllJobs();

            // Persist to DB so config survives container restarts
            JenkinsConfig saved = configRepository.findTopByOrderByIdDesc()
                .orElseGet(JenkinsConfig::new);
            saved.setUrl(this.jenkinsUrl);
            saved.setJob(this.jobName);
            saved.setUser(this.jenkinsUser);
            saved.setToken(this.jenkinsToken);
            saved.setSlackWebhookUrl(this.slackWebhookUrl);
            saved.setSlaDurationSeconds(this.slaDurationSeconds);
            configRepository.save(saved);
            log.info("[CONFIG] Jenkins config saved to database");

            result.put("status", "success");
            result.put("message", "Jenkins configuration updated and saved");
            result.put("jobCount", jobs.size());
            result.put("jobs", jobs);
        } catch (Exception e) {
            log.warn("[CONFIG] Failed to update Jenkins configuration: {}", e.getMessage());
            result.put("status", "error");
            result.put("message", "Failed to update Jenkins configuration. Check server logs for details.");
            result.put("jobCount", 0);
        }
        return result;
    }

    public Map<String, Object> getJenkinsConfig() {
        Map<String, Object> config = new HashMap<>();
        config.put("url", this.jenkinsUrl != null ? this.jenkinsUrl : this.defaultJenkinsUrl);
        config.put("user", this.jenkinsUser != null ? this.jenkinsUser : this.defaultJenkinsUser);
        config.put("job", this.jobName != null ? this.jobName : this.defaultJobName);

        // Mask token for display
        String tokenToShow = this.jenkinsToken != null ? this.jenkinsToken : this.defaultJenkinsToken;
        if (tokenToShow != null && tokenToShow.length() > 4 && !tokenToShow.equals("your-jenkins-token-here")) {
            config.put("token", "***" + tokenToShow.substring(tokenToShow.length() - 4));
        } else {
            config.put("token", "");
        }

        // Mask Slack webhook for display (show only that it's configured)
        boolean slackConfigured = this.slackWebhookUrl != null && !this.slackWebhookUrl.isBlank();
        config.put("slackConfigured", slackConfigured);
        config.put("slackWebhookUrl", slackConfigured ? "***configured***" : "");

        config.put("slaDurationSeconds",
            this.slaDurationSeconds != null && this.slaDurationSeconds > 0
                ? String.valueOf(this.slaDurationSeconds) : "");

        return config;
    }

    public JenkinsBuildSummary getLatestBuildSummary(String jobName) {
        String apiUrl = buildJobApiUrl(jobName, "lastBuild", "api", "json");
        HttpEntity<String> entity = buildAuthEntity();
        ResponseEntity<Map> response = restTemplate.exchange(apiUrl, HttpMethod.GET, entity, Map.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> buildInfo = (Map<String, Object>) response.getBody();
        if (buildInfo == null) {
            return null;
        }

        JenkinsBuildSummary summary = new JenkinsBuildSummary();
        summary.setJobName(jobName);
        summary.setBuildNumber(toInteger(buildInfo.get("number")));
        summary.setResult((String) buildInfo.get("result"));
        summary.setBuilding(toBoolean(buildInfo.get("building")));
        summary.setUrl((String) buildInfo.get("url"));

        Long timestampMs = toLong(buildInfo.get("timestamp"));
        if (timestampMs != null) {
            summary.setTimestamp(LocalDateTime.ofInstant(Instant.ofEpochMilli(timestampMs), ZoneId.systemDefault()));
        }

        Long durationMs = toLong(buildInfo.get("duration"));
        summary.setDurationMs(durationMs);
        if (durationMs != null) {
            summary.setDurationSeconds(durationMs / 1000);
        }
        summary.setEstimatedDurationMs(toLong(buildInfo.get("estimatedDuration")));

        Long queueId = toLong(buildInfo.get("queueId"));
        summary.setQueueId(queueId);
        if (queueId != null && timestampMs != null) {
            Long queueWaitMs = fetchQueueWaitMs(queueId, timestampMs, entity);
            summary.setQueueWaitMs(queueWaitMs);
            if (durationMs != null) {
                summary.setTotalTimeMs(queueWaitMs != null ? durationMs + queueWaitMs : durationMs);
            }
        } else if (durationMs != null) {
            summary.setTotalTimeMs(durationMs);
        }

        extractCause(buildInfo, summary);
        return summary;
    }

    private HttpEntity<String> buildAuthEntity() {
        HttpHeaders headers = new HttpHeaders();
        String auth = jenkinsUser + ":" + jenkinsToken;
        byte[] encodedAuth = Base64.getEncoder().encode(auth.getBytes(StandardCharsets.UTF_8));
        String authHeader = "Basic " + new String(encodedAuth);
        headers.set("Authorization", authHeader);
        return new HttpEntity<>(headers);
    }

    private String buildJobApiUrl(String jobName, String... pathSegments) {
        UriComponentsBuilder builder = UriComponentsBuilder.fromHttpUrl(jenkinsUrl);
        builder.pathSegment("job", jobName);
        for (String segment : pathSegments) {
            builder.pathSegment(segment);
        }
        return builder.build().toUriString();
    }

    private Long fetchQueueWaitMs(Long queueId, Long buildTimestampMs, HttpEntity<String> entity) {
        try {
            String queueUrl = UriComponentsBuilder.fromHttpUrl(jenkinsUrl)
                .pathSegment("queue", "item", String.valueOf(queueId), "api", "json")
                .build()
                .toUriString();
            ResponseEntity<Map> queueResponse = restTemplate.exchange(queueUrl, HttpMethod.GET, entity, Map.class);
            @SuppressWarnings("unchecked")
            Map<String, Object> queueBody = (Map<String, Object>) queueResponse.getBody();
            Long inQueueSince = toLong(queueBody != null ? queueBody.get("inQueueSince") : null);
            if (inQueueSince != null) {
                long waitMs = buildTimestampMs - inQueueSince;
                return waitMs >= 0 ? waitMs : null;
            }
        } catch (Exception e) {
            log.warn("[JENKINS] Queue info unavailable: " + " {}", e.getMessage());
        }
        return null;
    }

    private void extractCause(Map<String, Object> buildInfo, JenkinsBuildSummary summary) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> actions = (List<Map<String, Object>>) buildInfo.get("actions");
        if (actions == null) {
            return;
        }
        for (Map<String, Object> action : actions) {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> causes = (List<Map<String, Object>>) action.get("causes");
            if (causes == null || causes.isEmpty()) {
                continue;
            }
            Map<String, Object> cause = causes.get(0);
            String userName = (String) cause.get("userName");
            String userId = (String) cause.get("userId");
            String shortDescription = (String) cause.get("shortDescription");
            summary.setStartedBy(userName != null ? userName : shortDescription);
            summary.setStartedByUserId(userId);
            summary.setCause(shortDescription);
            break;
        }
    }

    private Long toLong(Object value) {
        if (value instanceof Number) {
            return ((Number) value).longValue();
        }
        return null;
    }

    private Integer toInteger(Object value) {
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        return null;
    }

    private Boolean toBoolean(Object value) {
        if (value instanceof Boolean) {
            return (Boolean) value;
        }
        return null;
    }

    public void pollJenkinsJob() {
        try {
            log.info("[BACKEND] Polling Jenkins job at: {}", jenkinsUrl);
            String apiUrl = jenkinsUrl + "/job/" + jobName + "/lastBuild/api/json";
            HttpEntity<String> entity = buildAuthEntity();

            log.info("[BACKEND] Making request to: {}", apiUrl);
            ResponseEntity<Map> response = restTemplate.exchange(apiUrl, HttpMethod.GET, entity, Map.class);
            @SuppressWarnings("unchecked")
            Map<String, Object> buildInfo = (Map<String, Object>) response.getBody();
            if (buildInfo != null) {
                String status = (String) buildInfo.get("result");
                Long durationMs = toLong(buildInfo.get("duration"));
                Long timestampMs = toLong(buildInfo.get("timestamp"));
                if (durationMs == null || timestampMs == null) {
                    log.warn("[BACKEND] Build still in progress or missing fields, skipping");
                    return;
                }
                Long duration = durationMs / 1000;
                LocalDateTime timestamp = LocalDateTime.ofInstant(Instant.ofEpochMilli(timestampMs), ZoneId.systemDefault());

                // After saving, get all durations for this job
                List<JenkinsJob> jobs = getAllJobs();
                List<Long> durations = jobs.stream().map(JenkinsJob::getDuration).collect(Collectors.toList());

                // Call ML microservice
                Map<String, Object> request = new HashMap<>();
                request.put("durations", durations);
                HttpHeaders mlHeaders = new HttpHeaders();
                mlHeaders.setContentType(MediaType.APPLICATION_JSON);
                HttpEntity<Map<String, Object>> mlEntity = new HttpEntity<>(request, mlHeaders);
                boolean anomalyDetected = false;
                try {
                    log.info("[BACKEND] Calling ML service at: ", mlServiceUrl);
                    ResponseEntity<Map> mlResponse = restTemplate.postForEntity(mlServiceUrl, mlEntity, Map.class);
                    @SuppressWarnings("unchecked")
                    Map<String, Object> mlBody = (Map<String, Object>) mlResponse.getBody();
                    Object anomalies = mlBody.get("anomalies");
                    log.info("[BACKEND] ML service response: ", anomalies);
                    if (anomalies instanceof List && !((List<?>) anomalies).isEmpty()) {
                        anomalyDetected = true;
                        log.info("[BACKEND] Anomaly detected by ML service!");
                    }
                } catch (Exception e) {
                    log.warn("[BACKEND] ML service call failed: " + " {}", e.getMessage());
                }

                recordJobMetrics(jobName, status, duration, anomalyDetected);
            }
        } catch (Exception e) {
            log.warn("[BACKEND] Jenkins API call failed: " + " {}", e.getMessage());
        }
    }

    public List<JenkinsJob> getAllJobs() {
        try {
            log.info("[JENKINS] Fetching jobs from: {}", jenkinsUrl);

            HttpEntity<String> entity = buildAuthEntity();
            String apiUrl = jenkinsUrl + "/api/json?tree=jobs[name,color]";
            ResponseEntity<Map> response = restTemplate.exchange(apiUrl, HttpMethod.GET, entity, Map.class);

            @SuppressWarnings("unchecked")
            Map<String, Object> body = (Map<String, Object>) response.getBody();
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> jobs = (List<Map<String, Object>>) body.get("jobs");

            log.info("[JENKINS] Found {} jobs", jobs != null ? jobs.size() : 0);

            List<JenkinsJob> result = new java.util.ArrayList<>();
            if (jobs != null) {
                for (Map<String, Object> job : jobs) {
                    String name = (String) job.get("name");
                    try {
                        String buildUrl = jenkinsUrl + "/job/" + name + "/lastBuild/api/json";
                        ResponseEntity<Map> buildResp = restTemplate.exchange(buildUrl, HttpMethod.GET, entity, Map.class);
                        @SuppressWarnings("unchecked")
                        Map<String, Object> buildInfo = (Map<String, Object>) buildResp.getBody();
                        if (buildInfo != null) {
                            String status = (String) buildInfo.get("result");
                            Long durationMs = toLong(buildInfo.get("duration"));
                            Long timestampMs = toLong(buildInfo.get("timestamp"));
                            if (durationMs == null || timestampMs == null) {
                                log.warn("[JENKINS] Skipping in-progress build for job {}", name);
                                result.add(new JenkinsJob(name, "IN_PROGRESS", LocalDateTime.now(), 0L));
                                continue;
                            }
                            Long duration = durationMs / 1000;
                            LocalDateTime timestamp = LocalDateTime.ofInstant(Instant.ofEpochMilli(timestampMs), ZoneId.systemDefault());
                            result.add(new JenkinsJob(name, status, timestamp, duration));
                            log.info("[JENKINS] Added job: {} status={}", name, status);
                        }
                    } catch (Exception buildEx) {
                        log.warn("[JENKINS] Failed to fetch build info for job {}: {}", name, buildEx.getMessage());
                        result.add(new JenkinsJob(name, "UNKNOWN", LocalDateTime.now(), 0L));
                    }
                }
            }
            // Merge cached anomaly/risk/streak data so every broadcast carries insights
            for (JenkinsJob job : result) {
                Map<String, Object> cached = insightsCache.get(job.getJobName());
                if (cached != null) {
                    job.setAnomaly(Boolean.TRUE.equals(cached.get("anomaly")));
                    job.setRiskLevel((String) cached.get("riskLevel"));
                    Object fp = cached.get("failureProbability");
                    if (fp instanceof Number) job.setFailureProbability(((Number) fp).doubleValue());
                    Object fs = cached.get("flakinessScore");
                    if (fs instanceof Number) job.setFlakinessScore(((Number) fs).doubleValue());
                    job.setFlaky(Boolean.TRUE.equals(cached.get("flaky")));
                    Object cf = cached.get("consecutiveFailures");
                    if (cf instanceof Number) job.setConsecutiveFailures(((Number) cf).intValue());
                    job.setSlaBreach(Boolean.TRUE.equals(cached.get("slaBreach")));
                    Object hs = cached.get("healthScore");
                    if (hs instanceof Number) job.setHealthScore(((Number) hs).intValue());
                }
            }

            log.info("[JENKINS] Returning {} jobs", result.size());
            return result;
        } catch (Exception e) {
            log.warn("[JENKINS] Jenkins API call failed: {}", e.getMessage());
            return java.util.Collections.emptyList();
        }
    }

    /**
     * Builds a CSV string of the persisted build history for a given job.
     * Pulls straight from the DB so it works even when Jenkins is unreachable.
     */
    public String exportBuildHistoryCsv(String jobName) {
        List<BuildRecord> records = buildRecordRepository.findByJobNameOrderByTimestampAsc(jobName);
        StringBuilder sb = new StringBuilder();
        sb.append("build_number,status,duration_seconds,timestamp\n");
        for (BuildRecord r : records) {
            sb.append(r.getBuildNumber()).append(',')
              .append(r.getStatus()).append(',')
              .append(r.getDurationSeconds()).append(',')
              .append(r.getTimestamp()).append('\n');
        }
        return sb.toString();
    }

    /**
     * Called by the background monitor. Runs getJobInsights() for every known job
     * and caches the result so it's baked into the next WebSocket broadcast.
     */
    public void monitorAllJobs() {
        List<JenkinsJob> jobs;
        try {
            jobs = getAllJobs();
        } catch (Exception e) {
            log.warn("[MONITOR] Could not fetch job list: {}", e.getMessage());
            return;
        }
        for (JenkinsJob job : jobs) {
            try {
                Map<String, Object> insights = getJobInsights(job.getJobName());
                insightsCache.put(job.getJobName(), insights);
                log.debug("[MONITOR] Cached insights for job={} anomaly={} risk={}",
                    job.getJobName(), insights.get("anomaly"), insights.get("riskLevel"));
            } catch (Exception e) {
                log.warn("[MONITOR] Insight check failed for job={}: {}", job.getJobName(), e.getMessage());
            }
        }
    }

    public void recordJobMetrics(String jobName, String status, long durationSeconds, boolean anomalyDetected) {
        int statusValue = "SUCCESS".equalsIgnoreCase(status) ? 1 : 0;
        meterRegistry.gauge("jenkins_job_status", Tags.of("job", jobName), statusValue);
        meterRegistry.gauge("jenkins_job_duration_seconds", Tags.of("job", jobName), durationSeconds);
        meterRegistry.gauge("jenkins_job_anomaly", Tags.of("job", jobName), anomalyDetected ? 1 : 0);
    }
    
    // Method to manually trigger polling for frontend
    public Map<String, Object> triggerPoll() {
        Map<String, Object> result = new HashMap<>();
        try {
            pollJenkinsJob();
            List<JenkinsJob> jobs = getAllJobs();
            result.put("status", "success");
            result.put("message", "Jenkins polling completed successfully");
            result.put("jobs", jobs);
        } catch (Exception e) {
            log.warn("[POLL] Jenkins polling failed: {}", e.getMessage());
            result.put("status", "error");
            result.put("message", "Jenkins polling failed. Check server logs for details.");
            result.put("jobs", java.util.Collections.emptyList());
        }
        return result;
    }

    public Map<String, Object> triggerBuild(String jobName) {
        Map<String, Object> result = new HashMap<>();
        try {
            HttpEntity<String> authEntity = buildAuthEntity();

            // 1. Fetch CSRF crumb
            String crumbUrl = jenkinsUrl + "/crumbIssuer/api/json";
            ResponseEntity<Map> crumbResponse = restTemplate.exchange(
                crumbUrl, HttpMethod.GET, authEntity, Map.class);
            Map crumbData = crumbResponse.getBody();

            // 2. Build trigger request with crumb header
            HttpHeaders headers = new HttpHeaders();
            String auth = jenkinsUser + ":" + jenkinsToken;
            headers.set("Authorization", "Basic " + Base64.getEncoder()
                .encodeToString(auth.getBytes(StandardCharsets.UTF_8)));
            if (crumbData != null && crumbData.get("crumb") != null) {
                String crumbField = (String) crumbData.get("crumbRequestField");
                String crumb = (String) crumbData.get("crumb");
                headers.set(crumbField != null ? crumbField : "Jenkins-Crumb", crumb);
            }
            HttpEntity<String> triggerEntity = new HttpEntity<>(headers);

            // 3. POST to /job/{name}/build
            String buildUrl = buildJobApiUrl(jobName, "build");
            restTemplate.exchange(buildUrl, HttpMethod.POST, triggerEntity, String.class);

            result.put("status", "success");
            result.put("message", "Build triggered for job: " + jobName);
        } catch (Exception e) {
            log.warn("[BUILD] Failed to trigger build for job={}: {}", jobName, e.getMessage());
            result.put("status", "error");
            result.put("message", "Failed to trigger build. Check server logs for details.");
        }
        return result;
    }

    public Map<String, Object> debugConnection() {
        Map<String, Object> result = new HashMap<>();
        try {
            result.put("jenkinsUrl", jenkinsUrl);
            result.put("jenkinsUser", jenkinsUser);
            result.put("tokenLength", jenkinsToken != null ? jenkinsToken.length() : 0);
            
            // Test basic connection
            String apiUrl = jenkinsUrl + "/api/json";
            HttpHeaders headers = new HttpHeaders();
            String auth = jenkinsUser + ":" + jenkinsToken;
            byte[] encodedAuth = Base64.getEncoder().encode(auth.getBytes(StandardCharsets.UTF_8));
            String authHeader = "Basic " + new String(encodedAuth);
            headers.set("Authorization", authHeader);
            HttpEntity<String> entity = new HttpEntity<>(headers);
            
            log.info("[DEBUG] Testing connection to: ", apiUrl);
            log.info("[DEBUG] Auth header: ", authHeader.substring(0, 20) + "...");
            
            ResponseEntity<Map> response = restTemplate.exchange(apiUrl, HttpMethod.GET, entity, Map.class);
            result.put("connectionStatus", "SUCCESS");
            result.put("responseCode", response.getStatusCode().value());
            
            @SuppressWarnings("unchecked")
            Map<String, Object> body = (Map<String, Object>) response.getBody();
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> jobs = (List<Map<String, Object>>) body.get("jobs");
            result.put("rawJobsCount", jobs != null ? jobs.size() : 0);
            result.put("rawJobs", jobs);
            
        } catch (Exception e) {
            log.warn("[DEBUG] Jenkins connection test failed: {}", e.getMessage());
            result.put("connectionStatus", "FAILED");
            result.put("error", e.getClass().getSimpleName());
        }
        return result;
    }

    private List<JenkinsJob> getJobBuildHistory(String jobName) {
        List<JenkinsJob> history = new java.util.ArrayList<>();
        try {
            String buildsUrl = jenkinsUrl + "/job/" + jobName + "/api/json?tree=builds[number,result,duration,timestamp]";
            ResponseEntity<Map> response = restTemplate.exchange(buildsUrl, HttpMethod.GET, buildAuthEntity(), Map.class);
            @SuppressWarnings("unchecked")
            Map<String, Object> body = (Map<String, Object>) response.getBody();
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> builds = (List<Map<String, Object>>) body.get("builds");

            if (builds != null) {
                for (Map<String, Object> build : builds) {
                    String status = (String) build.get("result");
                    if (status == null) continue; // skip in-progress
                    Integer buildNumber = toInteger(build.get("number"));
                    Long duration = ((Number) build.get("duration")).longValue() / 1000;
                    Long ts = ((Number) build.get("timestamp")).longValue();
                    LocalDateTime timestamp = LocalDateTime.ofInstant(Instant.ofEpochMilli(ts), ZoneId.systemDefault());

                    // Persist to DB if not already stored (idempotent)
                    if (buildNumber != null && !buildRecordRepository.existsByJobNameAndBuildNumber(jobName, buildNumber)) {
                        buildRecordRepository.save(new BuildRecord(jobName, buildNumber, status, duration, timestamp));
                    }
                }
            }

            // Return the full DB history (oldest first) — survives restarts
            buildRecordRepository.findByJobNameOrderByTimestampAsc(jobName)
                .forEach(r -> history.add(new JenkinsJob(r.getJobName(), r.getStatus(), r.getTimestamp(), r.getDurationSeconds())));

            log.info("[JENKINS] History for {}: {} builds (from DB)", jobName, history.size());
        } catch (Exception e) {
            log.info("[JENKINS] Failed to fetch build history for ", jobName + ": " + e.getMessage());
        }
        return history;
    }

    public Map<String, Object> getJobInsights(String jobName) {
        log.info("[JENKINS] Fetching job insights for: {}", jobName);
        List<JenkinsJob> jobs = getJobBuildHistory(jobName);
        Map<String, Object> result = new HashMap<>();
        result.put("history", jobs);
        boolean anomaly = false;
        boolean isFailure = false;
        String insight = "Normal";
        int streak = 0;

        if (!jobs.isEmpty()) {
            JenkinsJob latest = jobs.get(jobs.size() - 1);
            String currentStatus = latest.getStatus();
            String previousStatus = lastKnownStatus.get(jobName);

            // Check for recovery: was failing, now success (no cooldown — recovery always fires once)
            if ("SUCCESS".equalsIgnoreCase(currentStatus) && "FAILURE".equalsIgnoreCase(previousStatus)) {
                slackAlertService.sendRecoveryAlert(slackWebhookUrl, jobName, latest.getDuration());
                lastAlertTime.remove(jobName); // reset cooldown so next failure alerts immediately
            }

            // ML anomaly detection
            try {
                Map<String, Object> request = new HashMap<>();
                request.put("durations", jobs.stream().map(JenkinsJob::getDuration).collect(Collectors.toList()));
                request.put("statuses", jobs.stream().map(JenkinsJob::getStatus).collect(Collectors.toList()));
                request.put("latest_status", currentStatus);
                request.put("latest_duration", latest.getDuration());
                HttpHeaders mlHeaders = new HttpHeaders();
                mlHeaders.setContentType(MediaType.APPLICATION_JSON);
                HttpEntity<Map<String, Object>> mlEntity = new HttpEntity<>(request, mlHeaders);
                ResponseEntity<Map> mlResponse = restTemplate.postForEntity(mlServiceUrl, mlEntity, Map.class);
                @SuppressWarnings("unchecked")
                Map<String, Object> mlBody = (Map<String, Object>) mlResponse.getBody();
                Object anomalies = mlBody.get("anomalies");
                if (anomalies instanceof List && !((List<?>) anomalies).isEmpty()) {
                    anomaly = true;
                    log.info("[ANOMALY] ML detected anomaly in job: {}", jobName);
                }
            } catch (Exception e) {
                log.warn("ML service call failed: {}", e.getMessage());
            }

            // SLA breach check
            boolean slaBreach = slaDurationSeconds != null && slaDurationSeconds > 0
                && latest.getDuration() != null && latest.getDuration() > slaDurationSeconds;
            if (slaBreach) {
                log.info("[SLA] Breach for job={} duration={}s sla={}s", jobName, latest.getDuration(), slaDurationSeconds);
                if (canAlert(jobName + "_sla")) {
                    slackAlertService.sendSlaBreachAlert(slackWebhookUrl, jobName, latest.getDuration(), slaDurationSeconds);
                    markAlerted(jobName + "_sla");
                }
            }
            result.put("slaBreach", slaBreach);

            // Failure always counts as anomaly
            if ("FAILURE".equalsIgnoreCase(currentStatus)) {
                anomaly = true;
                isFailure = true;
                log.info("[ANOMALY] Job failed: {}", jobName);
            }

            // Consecutive failure streak
            int streak = computeConsecutiveFailures(jobName);

            // Call AI once if anomaly detected — fetch real build log first
            if (anomaly) {
                String buildLog = fetchBuildLog(jobName);
                insight = claudeInsightService.getInsight(jobName, latest.getDuration(), isFailure, buildLog);
                if (canAlert(jobName)) {
                    String escalatedInsight = streak >= 3
                        ? String.format("🚨 %d consecutive failures — %s", streak, insight)
                        : insight;
                    if (isFailure) {
                        slackAlertService.sendBuildFailureAlert(slackWebhookUrl, jobName, latest.getDuration(), escalatedInsight);
                    } else {
                        slackAlertService.sendAnomalyAlert(slackWebhookUrl, jobName, latest.getDuration(), escalatedInsight);
                    }
                    markAlerted(jobName);
                    log.info("[ALERT] Slack alert sent for job={} streak={}", jobName, streak);
                } else {
                    log.info("[ALERT] Suppressed — cooldown active for job={}", jobName);
                }
            }

            result.put("consecutiveFailures", streak);
            lastKnownStatus.put(jobName, currentStatus);
        } else {
            result.put("consecutiveFailures", 0);
            result.put("slaBreach", false);
        }

        // Failure prediction — requires ≥5 builds in history
        double failureProbability = 0.0;
        String riskLevel = "LOW";
        if (jobs.size() >= 5) {
            try {
                String predictUrl = mlServiceUrl.replace("/analyze", "/predict-failure");
                List<Map<String, Object>> historyPayload = jobs.stream().map(j -> {
                    Map<String, Object> entry = new HashMap<>();
                    entry.put("duration", j.getDuration());
                    entry.put("status", "SUCCESS".equalsIgnoreCase(j.getStatus()) ? 1 : 0);
                    return entry;
                }).collect(Collectors.toList());
                Map<String, Object> predictRequest = new HashMap<>();
                predictRequest.put("history", historyPayload);
                HttpHeaders mlHeaders = new HttpHeaders();
                mlHeaders.setContentType(MediaType.APPLICATION_JSON);
                ResponseEntity<Map> predictResponse = restTemplate.postForEntity(
                    predictUrl, new HttpEntity<>(predictRequest, mlHeaders), Map.class);
                Map<String, Object> predictBody = (Map<String, Object>) predictResponse.getBody();
                if (predictBody != null && predictBody.get("prob_failure") instanceof Number) {
                    failureProbability = ((Number) predictBody.get("prob_failure")).doubleValue();
                    if (failureProbability >= 0.6) riskLevel = "HIGH";
                    else if (failureProbability >= 0.3) riskLevel = "MEDIUM";
                    log.info("[PREDICT] job={} prob_failure={} risk={}", jobName, failureProbability, riskLevel);
                }
            } catch (Exception e) {
                log.warn("[PREDICT] Failure prediction unavailable for {}: {}", jobName, e.getMessage());
            }
        }

        double flakinessScore = computeFlakiness(jobs);
        int healthScore = computeHealthScore(jobs, streak, riskLevel);
        result.put("anomaly", anomaly);
        result.put("insight", insight);
        result.put("failureProbability", failureProbability);
        result.put("riskLevel", riskLevel);
        result.put("flakinessScore", flakinessScore);
        result.put("flaky", flakinessScore > 0.4);
        result.put("healthScore", healthScore);
        log.info("[RESULT] job={} anomaly={} risk={} flakiness={} health={}", jobName, anomaly, riskLevel, flakinessScore, healthScore);
        return result;
    }

    public List<JenkinsJob> getMockJobs() {
        JenkinsJob frontend = new JenkinsJob("frontend-deploy", "SUCCESS", LocalDateTime.now().minusMinutes(5), 45L);
        frontend.setAnomaly(true);
        frontend.setRiskLevel("MEDIUM");
        frontend.setFailureProbability(0.38);
        frontend.setFlakinessScore(0.0);
        frontend.setFlaky(false);
        frontend.setConsecutiveFailures(0);
        frontend.setHealthScore(62);

        JenkinsJob backend = new JenkinsJob("backend-api", "FAILURE", LocalDateTime.now().minusMinutes(12), 30L);
        backend.setAnomaly(true);
        backend.setRiskLevel("HIGH");
        backend.setFailureProbability(0.81);
        backend.setFlakinessScore(0.5);
        backend.setFlaky(true);
        backend.setConsecutiveFailures(2);
        backend.setHealthScore(18);

        JenkinsJob ml = new JenkinsJob("ml-pipeline", "SUCCESS", LocalDateTime.now().minusMinutes(30), 90L);
        ml.setAnomaly(false);
        ml.setRiskLevel("LOW");
        ml.setFailureProbability(0.07);
        ml.setFlakinessScore(0.0);
        ml.setFlaky(false);
        ml.setConsecutiveFailures(0);
        ml.setHealthScore(94);

        return java.util.Arrays.asList(frontend, backend, ml);
    }

    public Map<String, Object> getMockJobInsights(String jobName) {
        Map<String, Object> result = new HashMap<>();
        List<JenkinsJob> history = new java.util.ArrayList<>();
        boolean anomaly = false;
        String insight;

        switch (jobName) {
            case "frontend-deploy":
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(5), 42L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(4), 44L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(3), 120L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(2), 43L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusMinutes(5), 45L));
                anomaly = true;
                insight = "Anomaly detected: Build 3 days ago took 120s vs average of ~44s. Likely cause: npm dependency cache miss or slow registry response during install step.";
                result.put("failureProbability", 0.38);
                result.put("riskLevel", "MEDIUM");
                result.put("consecutiveFailures", 0);
                break;
            case "backend-api":
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(4), 55L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(3), 58L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(2), 52L));
                history.add(new JenkinsJob(jobName, "FAILURE", LocalDateTime.now().minusDays(1), 20L));
                history.add(new JenkinsJob(jobName, "FAILURE", LocalDateTime.now().minusMinutes(12), 30L));
                anomaly = true;
                insight = "FAILURE: 2 consecutive failures detected. Build exits early (30s vs normal 55s) suggesting startup crash. Likely cause: missing environment variable or database connection timeout on deploy. Check application logs for NullPointerException or connection refused errors.";
                result.put("failureProbability", 0.81);
                result.put("riskLevel", "HIGH");
                result.put("consecutiveFailures", 2);
                break;
            case "ml-pipeline":
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(5), 88L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(4), 92L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(3), 85L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(2), 91L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusMinutes(30), 90L));
                anomaly = false;
                insight = "All builds healthy. Consistent duration ~90s across 5 builds. No anomalies detected.";
                result.put("failureProbability", 0.07);
                result.put("riskLevel", "LOW");
                result.put("consecutiveFailures", 0);
                break;
            default:
                insight = "No mock data available for job: " + jobName;
                result.put("failureProbability", 0.0);
                result.put("riskLevel", "LOW");
                result.put("consecutiveFailures", 0);
        }

        double mockFlakiness = "backend-api".equals(jobName) ? 0.5 : 0.0;
        String rl = result.containsKey("riskLevel") ? (String) result.get("riskLevel") : "LOW";
        result.put("healthScore", result.containsKey("healthScore") ? result.get("healthScore")
            : computeHealthScore(history, 0, rl));
        result.put("history", history);
        result.put("anomaly", anomaly);
        result.put("insight", insight);
        result.put("flakinessScore", mockFlakiness);
        result.put("flaky", mockFlakiness > 0.4);
        return result;
    }

    /**
     * Fetches pipeline stage breakdown for the latest build via the Pipeline API.
     * Returns an empty list for freestyle jobs (they have no stages).
     */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getJobStages(String jobName) {
        try {
            String url = jenkinsUrl + "/job/" + jobName + "/lastBuild/wfapi/describe";
            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.GET, buildAuthEntity(), Map.class);
            Map<String, Object> body = (Map<String, Object>) response.getBody();
            if (body == null) return java.util.Collections.emptyList();
            List<Map<String, Object>> raw = (List<Map<String, Object>>) body.get("stages");
            if (raw == null) return java.util.Collections.emptyList();

            List<Map<String, Object>> stages = new java.util.ArrayList<>();
            for (Map<String, Object> s : raw) {
                Map<String, Object> stage = new HashMap<>();
                stage.put("name",            s.get("name"));
                stage.put("status",          s.get("status"));
                stage.put("durationMillis",  s.get("durationMillis"));
                stage.put("durationSeconds", s.get("durationMillis") instanceof Number
                    ? ((Number) s.get("durationMillis")).longValue() / 1000 : 0);
                stages.add(stage);
            }
            log.info("[STAGES] job={} stages={}", jobName, stages.size());
            return stages;
        } catch (Exception e) {
            log.debug("[STAGES] Not available for job={}: {}", jobName, e.getMessage());
            return java.util.Collections.emptyList();
        }
    }

    /**
     * Fetches the last build console log from Jenkins.
     * Returns empty string if unavailable (Jenkins down, no builds yet, etc.).
     */
    private String fetchBuildLog(String jobName) {
        try {
            String logUrl = jenkinsUrl + "/job/" + jobName + "/lastBuild/consoleText";
            ResponseEntity<String> response = restTemplate.exchange(
                logUrl, HttpMethod.GET, buildAuthEntity(), String.class
            );
            String log = response.getBody();
            return ClaudeInsightService.truncateLog(log);
        } catch (Exception e) {
            log.warn("[JENKINS] Could not fetch build log for {}: {}", jobName, e.getMessage());
            return "";
        }
    }
} 
