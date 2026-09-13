package com.example.crudspring.repository;

import com.example.crudspring.models.BuildRecord;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface BuildRecordRepository extends JpaRepository<BuildRecord, Long> {
    List<BuildRecord> findByJobNameOrderByTimestampAsc(String jobName);
    boolean existsByJobNameAndBuildNumber(String jobName, Integer buildNumber);
}
