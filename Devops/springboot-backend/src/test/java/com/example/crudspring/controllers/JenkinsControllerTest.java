package com.example.crudspring.controllers;

import com.example.crudspring.dto.DebugConnectionResponse;
import com.example.crudspring.dto.JenkinsConfigView;
import com.example.crudspring.dto.JobInsightsResponse;
import com.example.crudspring.dto.StatusResponse;
import com.example.crudspring.models.AlertRecord;
import com.example.crudspring.models.JenkinsJob;
import com.example.crudspring.models.JenkinsBuildSummary;
import com.example.crudspring.repository.AlertRecordRepository;
import com.example.crudspring.services.EmployeService;
import com.example.crudspring.services.JenkinsService;
import com.example.crudspring.websocket.JenkinsPoller;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDateTime;
import java.util.List;

import static org.hamcrest.Matchers.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Slice test for JenkinsController — loads only the web layer.
 * Verifies HTTP status codes, response shapes, content-type headers,
 * Bean Validation (400 on bad input), and demo-mode gating.
 */
@WebMvcTest(JenkinsController.class)
class JenkinsControllerTest {

    @Autowired
    MockMvc mvc;

    @MockBean JenkinsService          jenkinsService;
    @MockBean JenkinsPoller           jenkinsPoller;
    @MockBean AlertRecordRepository   alertRecordRepository;
    @MockBean EmployeService          employeService;   // needed by CrudSpringApplication CommandLineRunner

    // ── GET /api/jobs ─────────────────────────────────────────────────────────

    @Test
    void getAllJobs_returns200WithJobList() throws Exception {
        JenkinsJob job = new JenkinsJob("my-pipeline", "SUCCESS", LocalDateTime.now(), 45L);
        when(jenkinsService.getAllJobs()).thenReturn(List.of(job));

        mvc.perform(get("/api/jobs"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(1)))
            .andExpect(jsonPath("$[0].jobName", is("my-pipeline")));
    }

    @Test
    void getAllJobs_returnsEmptyListWhenNoJobs() throws Exception {
        when(jenkinsService.getAllJobs()).thenReturn(List.of());

        mvc.perform(get("/api/jobs"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(0)));
    }

    // ── GET /api/jobs/{jobName} ───────────────────────────────────────────────

    @Test
    void getJobDetails_returns200WithInsights() throws Exception {
        JobInsightsResponse insights = new JobInsightsResponse(
            List.of(), false, 0, false, "Normal", 0.1, "LOW", 0.0, false, 80);
        when(jenkinsService.getJobInsights("my-pipeline")).thenReturn(insights);

        mvc.perform(get("/api/jobs/my-pipeline"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.riskLevel", is("LOW")))
            .andExpect(jsonPath("$.healthScore", is(80)));
    }

    // ── GET /api/jobs/{jobName}/summary ───────────────────────────────────────

    @Test
    void getJobSummary_returns200() throws Exception {
        JenkinsBuildSummary summary = new JenkinsBuildSummary();
        summary.setBuildNumber(42);
        summary.setResult("SUCCESS");
        when(jenkinsService.getLatestBuildSummary("my-pipeline")).thenReturn(summary);

        mvc.perform(get("/api/jobs/my-pipeline/summary"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.buildNumber", is(42)))
            .andExpect(jsonPath("$.result", is("SUCCESS")));
    }

    // ── GET /api/jenkins/test ─────────────────────────────────────────────────

    @Test
    void testConnection_returnsSuccessWhenJenkinsReachable() throws Exception {
        JenkinsJob job = new JenkinsJob("job-a", "SUCCESS", LocalDateTime.now(), 30L);
        when(jenkinsService.getAllJobs()).thenReturn(List.of(job));

        mvc.perform(get("/api/jenkins/test"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status", is("success")))
            .andExpect(jsonPath("$.jobCount", is(1)));
    }

    @Test
    void testConnection_returnsErrorStatusWhenJenkinsThrows() throws Exception {
        when(jenkinsService.getAllJobs()).thenThrow(new RuntimeException("Connection refused"));

        mvc.perform(get("/api/jenkins/test"))
            .andExpect(status().isOk())              // controller catches it and returns 200 error body
            .andExpect(jsonPath("$.status", is("error")))
            .andExpect(jsonPath("$.message", containsString("Connection refused")));
    }

    // ── POST /api/jenkins/poll ────────────────────────────────────────────────

    @Test
    void triggerPoll_returns200AndCallsPushNow() throws Exception {
        when(jenkinsService.triggerPoll()).thenReturn(StatusResponse.ok("Polled"));

        mvc.perform(post("/api/jenkins/poll"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status", is("success")));

        verify(jenkinsPoller).pushNow();
    }

    // ── POST /api/jenkins/config ──────────────────────────────────────────────

    @Test
    void updateConfig_returns200ForValidUrl() throws Exception {
        when(jenkinsService.updateJenkinsConfig(any())).thenReturn(StatusResponse.ok("Config updated"));

        mvc.perform(post("/api/jenkins/config")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"http://jenkins:8080\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status", is("success")));
    }

    @Test
    void updateConfig_returns400ForInvalidUrl() throws Exception {
        mvc.perform(post("/api/jenkins/config")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"not-a-url\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status", is("error")))
            .andExpect(jsonPath("$.errors.url", notNullValue()));
    }

    @Test
    void updateConfig_returns400ForBlankUrl() throws Exception {
        mvc.perform(post("/api/jenkins/config")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors.url", notNullValue()));
    }

    @Test
    void updateConfig_returns400ForHttpsUrl() throws Exception {
        when(jenkinsService.updateJenkinsConfig(any())).thenReturn(StatusResponse.ok("Config updated"));

        mvc.perform(post("/api/jenkins/config")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://jenkins.example.com\"}"))
            .andExpect(status().isOk());
    }

    // ── GET /api/jenkins/config ───────────────────────────────────────────────

    @Test
    void getConfig_returns200() throws Exception {
        JenkinsConfigView view = new JenkinsConfigView("http://jenkins:8080", "admin", "my-job", "***", false, null, null);
        when(jenkinsService.getJenkinsConfig()).thenReturn(view);

        mvc.perform(get("/api/jenkins/config"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.url", is("http://jenkins:8080")));
    }

    // ── GET /api/jobs/{jobName}/history/export ────────────────────────────────

    @Test
    void exportCsv_returnsTextCsvContentType() throws Exception {
        when(jenkinsService.exportBuildHistoryCsv("my-pipeline"))
            .thenReturn("timestamp,status,duration\n2024-01-01,SUCCESS,45\n");

        mvc.perform(get("/api/jobs/my-pipeline/history/export"))
            .andExpect(status().isOk())
            .andExpect(content().contentTypeCompatibleWith("text/csv"))
            .andExpect(header().string("Content-Disposition", containsString("my-pipeline_build_history.csv")))
            .andExpect(content().string(containsString("SUCCESS")));
    }

    @Test
    void exportCsv_sanitisesJobNameInFilename() throws Exception {
        // Use a colon (no percent-encoding needed); replaceAll("[^a-zA-Z0-9_-]","_") → my_unsafe_job
        when(jenkinsService.exportBuildHistoryCsv("my:unsafe:job"))
            .thenReturn("timestamp,status,duration\n");

        mvc.perform(get("/api/jobs/my:unsafe:job/history/export"))
            .andExpect(header().string("Content-Disposition",
                containsString("my_unsafe_job_build_history.csv")));
    }

    // ── POST /api/jobs/{jobName}/trigger ──────────────────────────────────────

    @Test
    void triggerBuild_returns200() throws Exception {
        when(jenkinsService.triggerBuild("my-pipeline"))
            .thenReturn(StatusResponse.ok("Build triggered"));

        mvc.perform(post("/api/jobs/my-pipeline/trigger"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status", is("success")));
    }

    // ── GET /api/alerts ───────────────────────────────────────────────────────

    @Test
    void getAlerts_returns200WithAlertList() throws Exception {
        AlertRecord alert = new AlertRecord("my-pipeline", "FAILURE", "Build failed");
        when(alertRecordRepository.findTop100ByOrderByTimestampDesc()).thenReturn(List.of(alert));

        mvc.perform(get("/api/alerts"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$", hasSize(1)))
            .andExpect(jsonPath("$[0].alertType", is("FAILURE")));
    }

    // ── GET /api/jenkins/mock (demo mode disabled by default) ─────────────────

    @Test
    void getMockJobs_returns404WhenDemoModeDisabled() throws Exception {
        mvc.perform(get("/api/jenkins/mock"))
            .andExpect(status().isNotFound());
    }

    @Test
    void getMockJobInsights_returns404WhenDemoModeDisabled() throws Exception {
        mvc.perform(get("/api/jenkins/mock/some-job"))
            .andExpect(status().isNotFound());
    }

    // ── GET /api/jenkins/debug ────────────────────────────────────────────────

    @Test
    void debugConnection_returns200() throws Exception {
        DebugConnectionResponse debug = new DebugConnectionResponse(
            "http://jenkins:8080", "admin", 10, "Connected", 200, 3, null, null);
        when(jenkinsService.debugConnection()).thenReturn(debug);

        mvc.perform(get("/api/jenkins/debug"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.connectionStatus", is("Connected")));
    }
}
