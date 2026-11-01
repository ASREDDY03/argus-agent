package com.example.crudspring.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;

/**
 * Response for GET /api/jenkins/debug — connection diagnostics.
 * Null fields (rawJobs, error) are omitted when not applicable.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record DebugConnectionResponse(
    String jenkinsUrl,
    String jenkinsUser,
    int tokenLength,
    String connectionStatus,
    Integer responseCode,
    Integer rawJobsCount,
    List<Map<String, Object>> rawJobs,
    String error
) {}
