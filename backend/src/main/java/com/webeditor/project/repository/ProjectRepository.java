package com.webeditor.project.repository;

import com.webeditor.project.domain.Project;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProjectRepository extends JpaRepository<Project, Long> {
    Optional<Project> findByIdAndTeamIdAndStatusAndLegacyUnownedFalse(long id, long teamId, byte status);
    @Query("select p from Project p join TeamMember m on m.teamId = p.teamId where m.userId = :userId and m.status = 'ACTIVE' and p.teamId = :teamId and p.status = 1 and p.legacyUnowned = false")
    Page<Project> findVisible(@Param("teamId") long teamId, @Param("userId") long userId, Pageable pageable);
    Page<Project> findAllByStatus(byte status, Pageable pageable);

    Optional<Project> findByIdAndStatus(Long id, byte status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Project p where p.id = :id and p.status = 1")
    Optional<Project> findActiveByIdForUpdate(@Param("id") Long id);
}
