package com.example.crudspring.controllers;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import jakarta.validation.Valid;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import com.example.crudspring.dto.DebugConnectionResponse;
import com.example.crudspring.dto.JenkinsConfigView;
import com.example.crudspring.dto.JobInsightsResponse;
import com.example.crudspring.dto.StatusResponse;
import com.example.crudspring.models.AlertRecord;
import com.example.crudspring.repository.AlertRecordRepository;
import com.example.crudspring.services.JenkinsService;
import com.example.crudspring.models.JenkinsJob;
import com.example.crudspring.models.JenkinsBuildSummary;
import com.example.crudspring.websocket.JenkinsPoller;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import com.example.crudspring.dto.JenkinsConfigRequest;

@Tag(name = "Jenkins", description = "Jenkins monitoring and configuration endpoints")
@RestController
public class JenkinsController {
    private final JenkinsService jenkinsService;
    private final JenkinsPoller jenkinsPoller;
    private final AlertRecordRepository alertRecordRepository;

    @Value("${demo.mode.enabled:false}")
    private boolean demoModeEnabled;

    public JenkinsController(JenkinsService jenkinsService, JenkinsPoller jenkinsPoller,
                             AlertRecordRepository alertRecordRepository) {
        this.jenkinsService        = jenkinsService;
        this.jenkinsPoller         = jenkinsPoller;
        this.alertRecordRepository = alertRecordRepository;
    }

    @Operation(summary = "List all monitored jobs with latest status and ML scores")
    @GetMapping("/api/jobs")
    public List<JenkinsJob> getAllJobs() {
        return jenkinsService.getAllJobs();
    }

    @Operation(summary = "Full ML insights for one job (anomaly, risk, flakiness, history)")
    @GetMapping("/api/jobs/{jobName}")
    public JobInsightsResponse getJobDetails(@PathVariable String jobName) {
        return jenkinsService.getJobInsights(jobName);
    }

    @GetMapping("/api/jobs/{jobName}/summary")
    public JenkinsBuildSummary getJobSummary(@PathVariable String jobName) {
        return jenkinsService.getLatestBuildSummary(jobName);
    }

    @GetMapping("/api/jenkins/test")
    public StatusResponse testJenkinsConnection() {
        try {
            List<JenkinsJob> jobs = jenkinsService.getAllJobs();
            return StatusResponse.ok("Connected to Jenkins successfully", jobs.size(), jobs);
        } catch (Exception e) {
            return new StatusResponse("error", "Failed to connect to Jenkins: " + e.getMessage(),
                0, null, e.getClass().getSimpleName());
        }
    }

    @GetMapping("/api/jenkins/debug")
    public DebugConnectionResponse debugJenkinsConnection() {
        return jenkinsService.debugConnection();
    }

    @PostMapping("/api/jenkins/poll")
    public StatusResponse triggerPoll() {
        StatusResponse result = jenkinsService.triggerPoll();
        jenkinsPoller.pushNow(); // push update to all WebSocket clients immediately
        return result;
    }

    @Operation(summary = "Update Jenkins connection settings (URL, user, token, SLA)")
    @PostMapping("/api/jenkins/config")
    public StatusResponse updateJenkinsConfig(@Valid @RequestBody JenkinsConfigRequest config) {
        return jenkinsService.updateJenkinsConfig(config.toMap());
    }

    /** Translate Bean Validation failures into a 400 with readable field errors. */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException ex) {
        Map<String, String> errors = ex.getBindingResult().getFieldErrors().stream()
                .collect(Collectors.toMap(FieldError::getField, FieldError::getDefaultMessage,
                        (a, b) -> a));
        return ResponseEntity.badRequest().body(Map.of("status", "error", "errors", errors));
    }

    @GetMapping("/api/jenkins/config")
    public JenkinsConfigView getJenkinsConfig() {
        return jenkinsService.getJenkinsConfig();
    }

    @GetMapping("/api/jobs/{jobName}/stages")
    public List<Map<String, Object>> getJobStages(@PathVariable String jobName) {
        return jenkinsService.getJobStages(jobName);
    }

    @GetMapping("/api/jobs/{jobName}/history/export")
    public ResponseEntity<String> exportBuildHistory(@PathVariable String jobName) {
        String csv = jenkinsService.exportBuildHistoryCsv(jobName);
        String filename = jobName.replaceAll("[^a-zA-Z0-9_-]", "_") + "_build_history.csv";
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType("text/csv"))
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
            .body(csv);
    }

    @PostMapping("/api/jobs/{jobName}/trigger")
    public StatusResponse triggerBuild(@PathVariable String jobName) {
        return jenkinsService.triggerBuild(jobName);
    }

    @GetMapping("/api/alerts")
    public List<AlertRecord> getAlerts() {
        return alertRecordRepository.findTop100ByOrderByTimestampDesc();
    }

    @GetMapping("/api/jenkins/mock")
    public ResponseEntity<?> getMockJobs() {
        if (!demoModeEnabled) return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        return ResponseEntity.ok(jenkinsService.getMockJobs());
    }

    @GetMapping("/api/jenkins/mock/{jobName}")
    public ResponseEntity<?> getMockJobInsights(@PathVariable String jobName) {
        if (!demoModeEnabled) return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        return ResponseEntity.ok(jenkinsService.getMockJobInsights(jobName));
    }
}
