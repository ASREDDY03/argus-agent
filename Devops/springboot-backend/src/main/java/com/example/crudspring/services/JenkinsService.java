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

    // Dynamic configuration - can be updated via API
    private String jenkinsUrl;
    private String jobName;
    private String jenkinsUser;
    private String jenkinsToken;

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
    private void initializeDefaults() {
        // Load persisted config from DB first; fall back to env/application.properties values
        configRepository.findTopByOrderByIdDesc().ifPresentOrElse(saved -> {
            this.jenkinsUrl   = saved.getUrl();
            this.jobName      = saved.getJob();
            this.jenkinsUser  = saved.getUser();
            this.jenkinsToken = saved.getToken();
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
            if (config.containsKey("url"))   this.jenkinsUrl   = config.get("url");
            if (config.containsKey("user"))  this.jenkinsUser  = config.get("user");
            if (config.containsKey("token")) this.jenkinsToken = config.get("token");
            if (config.containsKey("job"))   this.jobName      = config.get("job");

            // Test the connection with new credentials
            List<JenkinsJob> jobs = getAllJobs();

            // Persist to DB so config survives container restarts
            JenkinsConfig saved = configRepository.findTopByOrderByIdDesc()
                .orElseGet(JenkinsConfig::new);
            saved.setUrl(this.jenkinsUrl);
            saved.setJob(this.jobName);
            saved.setUser(this.jenkinsUser);
            saved.setToken(this.jenkinsToken);
            configRepository.save(saved);
            log.info("[CONFIG] Jenkins config saved to database");

            result.put("status", "success");
            result.put("message", "Jenkins configuration updated and saved");
            result.put("jobCount", jobs.size());
            result.put("jobs", jobs);
        } catch (Exception e) {
            result.put("status", "error");
            result.put("message", "Failed to update Jenkins configuration: " + e.getMessage());
            result.put("jobCount", 0);
        }
        return result;
    }

    public Map<String, Object> getJenkinsConfig() {
        Map<String, Object> config = new HashMap<>();
        config.put("url", this.jenkinsUrl != null ? this.jenkinsUrl : this.defaultJenkinsUrl);
        config.put("user", this.jenkinsUser != null ? this.jenkinsUser : this.defaultJenkinsUser);
        config.put("job", this.jobName != null ? this.jobName : this.defaultJobName);
        
        // Handle token display safely
        String tokenToShow = this.jenkinsToken != null ? this.jenkinsToken : this.defaultJenkinsToken;
        if (tokenToShow != null && tokenToShow.length() > 4 && !tokenToShow.equals("your-jenkins-token-here")) {
            config.put("token", "***" + tokenToShow.substring(tokenToShow.length() - 4));
        } else {
            config.put("token", "");
        }
        
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
            log.info("[BACKEND] Polling Jenkins job at: ", jenkinsUrl);
            // Call Jenkins API for last build info with Basic Auth
            String apiUrl = jenkinsUrl + "/job/" + jobName + "/lastBuild/api/json";
            HttpHeaders headers = new HttpHeaders();
            String auth = jenkinsUser + ":" + jenkinsToken;
            byte[] encodedAuth = Base64.getEncoder().encode(auth.getBytes(StandardCharsets.UTF_8));
            String authHeader = "Basic " + new String(encodedAuth);
            headers.set("Authorization", authHeader);
            HttpEntity<String> entity = new HttpEntity<>(headers);
            
            log.info("[BACKEND] Making request to: ", apiUrl);
            ResponseEntity<Map> response = restTemplate.exchange(apiUrl, HttpMethod.GET, entity, Map.class);
            @SuppressWarnings("unchecked")
            Map<String, Object> buildInfo = (Map<String, Object>) response.getBody();
            if (buildInfo != null) {
                String status = (String) buildInfo.get("result"); // e.g., "SUCCESS"
                Long duration = ((Number) buildInfo.get("duration")).longValue() / 1000; // ms to s
                Long timestampMs = ((Number) buildInfo.get("timestamp")).longValue();
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
                            Long duration = ((Number) buildInfo.get("duration")).longValue() / 1000;
                            Long timestampMs = ((Number) buildInfo.get("timestamp")).longValue();
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
            log.info("[JENKINS] Returning {} jobs", result.size());
            return result;
        } catch (Exception e) {
            log.warn("[JENKINS] Jenkins API call failed: {}", e.getMessage());
            return java.util.Collections.emptyList();
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
            result.put("status", "error");
            result.put("message", "Jenkins polling failed: " + e.getMessage());
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
            result.put("status", "error");
            result.put("message", "Failed to trigger build: " + e.getMessage());
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
            result.put("connectionStatus", "FAILED");
            result.put("error", e.getMessage());
            result.put("errorType", e.getClass().getSimpleName());
            e.printStackTrace();
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

        if (!jobs.isEmpty()) {
            JenkinsJob latest = jobs.get(jobs.size() - 1);
            String currentStatus = latest.getStatus();
            String previousStatus = lastKnownStatus.get(jobName);

            // Check for recovery: was failing, now success
            if ("SUCCESS".equalsIgnoreCase(currentStatus) && "FAILURE".equalsIgnoreCase(previousStatus)) {
                slackAlertService.sendRecoveryAlert(jobName, latest.getDuration());
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

            // Failure always counts as anomaly
            if ("FAILURE".equalsIgnoreCase(currentStatus)) {
                anomaly = true;
                isFailure = true;
                log.info("[ANOMALY] Job failed: {}", jobName);
            }

            // Call AI once if anomaly detected — fetch real build log first
            if (anomaly) {
                String buildLog = fetchBuildLog(jobName);
                insight = claudeInsightService.getInsight(jobName, latest.getDuration(), isFailure, buildLog);
                if (isFailure) {
                    slackAlertService.sendBuildFailureAlert(jobName, latest.getDuration(), insight);
                } else {
                    slackAlertService.sendAnomalyAlert(jobName, latest.getDuration(), insight);
                }
            }

            lastKnownStatus.put(jobName, currentStatus);
        }

        result.put("anomaly", anomaly);
        result.put("insight", insight);
        log.info("[RESULT] job={} anomaly={}", jobName, anomaly);
        return result;
    }

    public List<JenkinsJob> getMockJobs() {
        List<JenkinsJob> jobs = new java.util.ArrayList<>();
        jobs.add(new JenkinsJob("frontend-deploy", "SUCCESS", LocalDateTime.now().minusMinutes(5), 45L));
        jobs.add(new JenkinsJob("backend-api", "FAILURE", LocalDateTime.now().minusMinutes(12), 30L));
        jobs.add(new JenkinsJob("ml-pipeline", "SUCCESS", LocalDateTime.now().minusMinutes(30), 90L));
        return jobs;
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
                break;
            case "backend-api":
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(4), 55L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(3), 58L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(2), 52L));
                history.add(new JenkinsJob(jobName, "FAILURE", LocalDateTime.now().minusDays(1), 20L));
                history.add(new JenkinsJob(jobName, "FAILURE", LocalDateTime.now().minusMinutes(12), 30L));
                anomaly = true;
                insight = "FAILURE: 2 consecutive failures detected. Build exits early (30s vs normal 55s) suggesting startup crash. Likely cause: missing environment variable or database connection timeout on deploy. Check application logs for NullPointerException or connection refused errors.";
                break;
            case "ml-pipeline":
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(5), 88L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(4), 92L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(3), 85L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusDays(2), 91L));
                history.add(new JenkinsJob(jobName, "SUCCESS", LocalDateTime.now().minusMinutes(30), 90L));
                anomaly = false;
                insight = "All builds healthy. Consistent duration ~90s across 5 builds. No anomalies detected.";
                break;
            default:
                insight = "No mock data available for job: " + jobName;
        }

        result.put("history", history);
        result.put("anomaly", anomaly);
        result.put("insight", insight);
        return result;
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
