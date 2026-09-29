package com.webeditor.team.repository;

import com.webeditor.team.domain.Team;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TeamRepository extends JpaRepository<Team, Long> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from Team t where t.id = :id and t.status = 'ACTIVE'")
    Optional<Team> lockActive(@Param("id") long id);
    @Query("select t from Team t where t.status = 'ACTIVE' and t.joinPolicy = 'REQUEST' and lower(t.name) like lower(concat('%', :query, '%'))")
    Page<Team> discover(@Param("query") String query, Pageable pageable);
    @Query("select t from Team t join TeamMember m on m.teamId = t.id where m.userId = :userId and m.status = 'ACTIVE' and t.status = 'ACTIVE'")
    Page<Team> mine(@Param("userId") long userId, Pageable pageable);
}
