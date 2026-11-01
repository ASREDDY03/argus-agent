package com.example.crudspring.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.example.crudspring.models.JenkinsJob;
import java.util.List;

/**
 * Generic operation response used by config update, poll trigger, and build trigger endpoints.
 * Null fields are omitted from JSON serialization.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record StatusResponse(
    String status,
    String message,
    Integer jobCount,
    List<JenkinsJob> jobs,
    String error
) {
    public static StatusResponse ok(String message) {
        return new StatusResponse("success", message, null, null, null);
    }

    public static StatusResponse ok(String message, int jobCount, List<JenkinsJob> jobs) {
        return new StatusResponse("success", message, jobCount, jobs, null);
    }

    public static StatusResponse okWithJobs(String message, List<JenkinsJob> jobs) {
        return new StatusResponse("success", message, null, jobs, null);
    }

    public static StatusResponse error(String message) {
        return new StatusResponse("error", message, null, null, null);
    }

    public static StatusResponse error(String message, int jobCount) {
        return new StatusResponse("error", message, jobCount, null, null);
    }
}
