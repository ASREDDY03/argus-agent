package com.example.crudspring.repository;

import com.example.crudspring.models.AlertRecord;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface AlertRecordRepository extends JpaRepository<AlertRecord, Long> {
    List<AlertRecord> findTop100ByOrderByTimestampDesc();
    List<AlertRecord> findByJobNameOrderByTimestampDesc(String jobName);
}
