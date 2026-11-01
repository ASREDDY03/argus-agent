package com.example.crudspring.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.HashMap;
import java.util.Map;

/**
 * Validated request body for POST /api/jenkins/config.
 * All fields are optional except url — callers may omit fields they don't want to change.
 */
public record JenkinsConfigRequest(

    @NotBlank(message = "url must not be blank")
    @Pattern(regexp = "https?://.+", message = "url must start with http:// or https://")
    String url,

    @Size(max = 128, message = "user must be ≤ 128 characters")
    String user,

    @Size(max = 256, message = "token must be ≤ 256 characters")
    String token,

    @Size(max = 128, message = "job must be ≤ 128 characters")
    String job,

    String slackWebhookUrl,

    String slaDurationSeconds
) {
    /** Convert to the Map<String,String> expected by JenkinsService.updateJenkinsConfig(). */
    public Map<String, String> toMap() {
        Map<String, String> m = new HashMap<>();
        if (url              != null) m.put("url",              url);
        if (user             != null) m.put("user",             user);
        if (token            != null) m.put("token",            token);
        if (job              != null) m.put("job",              job);
        if (slackWebhookUrl  != null) m.put("slackWebhookUrl",  slackWebhookUrl);
        if (slaDurationSeconds != null) m.put("slaDurationSeconds", slaDurationSeconds);
        return m;
    }
}
