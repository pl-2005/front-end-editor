package com.webeditor.team.repository;

import com.webeditor.team.domain.TeamInvitation;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TeamInvitationRepository extends JpaRepository<TeamInvitation, Long> {
    Optional<TeamInvitation> findByTokenHash(String hash);
    Optional<TeamInvitation> findByIdAndTeamId(long id, long teamId);
    List<TeamInvitation> findByTeamIdOrderByIdDesc(long teamId);
}
