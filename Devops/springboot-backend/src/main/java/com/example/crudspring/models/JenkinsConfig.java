package com.example.crudspring.models;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "jenkins_config")
public class JenkinsConfig {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String url;
    private String job;
    private String user;
    private String token;
    private String slackWebhookUrl;

    public JenkinsConfig() {}

    public Long getId() { return id; }
    public String getUrl() { return url; }
    public String getJob() { return job; }
    public String getUser() { return user; }
    public String getToken() { return token; }
    public String getSlackWebhookUrl() { return slackWebhookUrl; }

    public void setUrl(String url) { this.url = url; }
    public void setJob(String job) { this.job = job; }
    public void setUser(String user) { this.user = user; }
    public void setToken(String token) { this.token = token; }
    public void setSlackWebhookUrl(String slackWebhookUrl) { this.slackWebhookUrl = slackWebhookUrl; }
}
