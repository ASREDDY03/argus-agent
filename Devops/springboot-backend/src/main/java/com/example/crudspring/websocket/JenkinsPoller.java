package com.example.crudspring.websocket;

import com.example.crudspring.models.JenkinsJob;
import com.example.crudspring.services.JenkinsService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class JenkinsPoller {

    private static final Logger log = LoggerFactory.getLogger(JenkinsPoller.class);

    private final JenkinsService jenkinsService;
    private final JobUpdateHandler jobUpdateHandler;
    private final ObjectMapper objectMapper;

    public JenkinsPoller(JenkinsService jenkinsService, JobUpdateHandler jobUpdateHandler,
                         ObjectMapper objectMapper) {
        this.jenkinsService    = jenkinsService;
        this.jobUpdateHandler  = jobUpdateHandler;
        this.objectMapper      = objectMapper;
    }

    /**
     * Polls Jenkins every 30 seconds and pushes the result to all connected WebSocket clients.
     * Skips broadcast if no clients are connected (saves unnecessary Jenkins API calls).
     */
    @Scheduled(fixedDelay = 30000, initialDelay = 30000)
    public void poll() {
        if (jobUpdateHandler.connectedClients() == 0) return;
        try {
            List<JenkinsJob> jobs = jenkinsService.getAllJobs();
            String json = objectMapper.writeValueAsString(jobs);
            jobUpdateHandler.broadcast(json);
            log.debug("[POLLER] Pushed {} jobs to {} client(s)", jobs.size(), jobUpdateHandler.connectedClients());
        } catch (Exception e) {
            log.warn("[POLLER] Failed to poll/broadcast: {}", e.getMessage());
        }
    }

    /** Called manually (e.g. after a user-triggered refresh) to push immediately. */
    public void pushNow() {
        try {
            List<JenkinsJob> jobs = jenkinsService.getAllJobs();
            String json = objectMapper.writeValueAsString(jobs);
            jobUpdateHandler.broadcast(json);
        } catch (Exception e) {
            log.warn("[POLLER] pushNow failed: {}", e.getMessage());
        }
    }
}
