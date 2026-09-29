package com.webeditor.team.repository;

import com.webeditor.team.domain.TeamMember;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TeamMemberRepository extends JpaRepository<TeamMember, Long> {
    Optional<TeamMember> findByTeamIdAndUserId(long teamId, long userId);
    Optional<TeamMember> findByTeamIdAndUserIdAndStatus(long teamId, long userId, String status);
    List<TeamMember> findByTeamIdAndStatusOrderById(long teamId, String status);
}
