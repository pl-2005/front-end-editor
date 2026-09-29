package com.webeditor.team.application;

import com.webeditor.identity.repository.AppUserRepository;
import com.webeditor.project.domain.Project;
import com.webeditor.project.repository.ProjectRepository;
import com.webeditor.team.domain.Team;
import com.webeditor.team.domain.TeamMember;
import com.webeditor.team.repository.TeamMemberRepository;
import com.webeditor.team.repository.TeamRepository;
import org.springframework.stereotype.Service;

@Service
public class TeamAccessService {
    private final AppUserRepository users;
    private final TeamRepository teams;
    private final TeamMemberRepository members;
    private final ProjectRepository projects;
    public TeamAccessService(AppUserRepository users, TeamRepository teams, TeamMemberRepository members, ProjectRepository projects) {
        this.users = users; this.teams = teams; this.members = members; this.projects = projects;
    }
    public TeamMember member(long teamId, long userId) {
        if (!users.existsById(userId) || teams.findById(teamId).filter(t -> "ACTIVE".equals(t.getStatus())).isEmpty())
            throw new TeamFailure(404, "TEAM_NOT_FOUND", "团队不存在");
        return members.findByTeamIdAndUserIdAndStatus(teamId, userId, "ACTIVE")
                .orElseThrow(() -> new TeamFailure(404, "TEAM_NOT_FOUND", "团队不存在"));
    }
    public TeamMember owner(long teamId, long userId) {
        TeamMember member = member(teamId, userId);
        if (!"OWNER".equals(member.getRole())) throw new TeamFailure(403, "ACCESS_DENIED", "仅团队所有者可执行此操作");
        return member;
    }
    public Project project(long teamId, long projectId, long userId) {
        member(teamId, userId);
        return projects.findByIdAndTeamIdAndStatusAndLegacyUnownedFalse(projectId, teamId, (byte) 1)
                .orElseThrow(() -> new TeamFailure(404, "PROJECT_NOT_FOUND", "项目不存在"));
    }
}
