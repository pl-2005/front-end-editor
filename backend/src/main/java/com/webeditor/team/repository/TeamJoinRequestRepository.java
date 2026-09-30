package com.webeditor.team.repository;

import com.webeditor.team.domain.TeamJoinRequest;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TeamJoinRequestRepository extends JpaRepository<TeamJoinRequest, Long> {
    Optional<TeamJoinRequest> findByTeamIdAndUserId(long teamId, long userId);
    Optional<TeamJoinRequest> findByIdAndTeamId(long id, long teamId);
    List<TeamJoinRequest> findByTeamIdAndStatusOrderByCreatedAt(long teamId, String status);
    List<TeamJoinRequest> findByUserIdAndStatusOrderByCreatedAt(long userId, String status);
}
