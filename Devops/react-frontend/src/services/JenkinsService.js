import axios from 'axios';

const API_BASE_URL = '/api';

class JenkinsService {
    getJobs() {
        return axios.get(`${API_BASE_URL}/jobs`);
    }
    
    pollJob() {
        // This will trigger the polling and return the jobs
        return axios.post(`${API_BASE_URL}/jenkins/poll`);
    }
    
    getJobDetails(jobName) {
        return axios.get(`${API_BASE_URL}/jobs/${encodeURIComponent(jobName)}`);
    }

    getJobSummary(jobName) {
        return axios.get(`${API_BASE_URL}/jobs/${encodeURIComponent(jobName)}/summary`);
    }
    
    testConnection() {
        return axios.get(`${API_BASE_URL}/jenkins/test`);
    }
    
    updateJenkinsConfig(config) {
        return axios.post(`${API_BASE_URL}/jenkins/config`, config);
    }
    
    getJenkinsConfig() {
        return axios.get(`${API_BASE_URL}/jenkins/config`);
    }

    getMockJobs() {
        return axios.get(`${API_BASE_URL}/jenkins/mock`);
    }

    getMockJobDetails(jobName) {
        return axios.get(`${API_BASE_URL}/jenkins/mock/${encodeURIComponent(jobName)}`);
    }

    getJobStages(jobName) {
        return axios.get(`${API_BASE_URL}/jobs/${encodeURIComponent(jobName)}/stages`);
    }

    getAlerts() {
        return axios.get(`${API_BASE_URL}/alerts`);
    }

    triggerBuild(jobName) {
        return axios.post(`${API_BASE_URL}/jobs/${encodeURIComponent(jobName)}/trigger`);
    }
}

export default new JenkinsService(); 
