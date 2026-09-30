package com.webeditor.team.repository;

import com.webeditor.team.domain.TeamInvitation;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TeamInvitationRepository extends JpaRepository<TeamInvitation, Long> {
    Optional<TeamInvitation> findByIdAndTeamId(long id, long teamId);
    List<TeamInvitation> findByTeamIdOrderByIdDesc(long teamId);
    @Query("select i from TeamInvitation i where i.status = 'PENDING' and i.inviteeUserId = :userId order by i.id desc")
    List<TeamInvitation> findPendingForUser(@Param("userId") long userId);
    @Query("select i from TeamInvitation i where i.teamId = :teamId and i.status = 'PENDING' and i.inviteeUserId = :userId")
    List<TeamInvitation> findPendingForTeamUser(@Param("teamId") long teamId, @Param("userId") long userId);
}
