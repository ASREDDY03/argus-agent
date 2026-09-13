package com.example.crudspring.repository;

import com.example.crudspring.models.JenkinsConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface JenkinsConfigRepository extends JpaRepository<JenkinsConfig, Long> {
    Optional<JenkinsConfig> findTopByOrderByIdDesc();
}
