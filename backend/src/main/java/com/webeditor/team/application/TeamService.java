package com.webeditor.team.application;

import com.webeditor.identity.application.IdentityInput;
import com.webeditor.identity.domain.AppUser;
import com.webeditor.identity.repository.AppUserRepository;
import com.webeditor.team.domain.*;
import com.webeditor.team.repository.*;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import jakarta.persistence.EntityManager;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TeamService {
    private final TeamRepository teams;
    private final TeamMemberRepository members;
    private final TeamInvitationRepository invitations;
    private final TeamJoinRequestRepository requests;
    private final AppUserRepository users;
    private final TeamAccessService access;
    private final EntityManager entityManager;
    public TeamService(TeamRepository teams, TeamMemberRepository members, TeamInvitationRepository invitations,
            TeamJoinRequestRepository requests, AppUserRepository users, TeamAccessService access, EntityManager entityManager) {
        this.teams = teams; this.members = members; this.invitations = invitations;
        this.requests = requests; this.users = users; this.access = access; this.entityManager = entityManager;
    }
    public record TeamView(long id, String name, String description, String joinPolicy) {
        static TeamView of(Team t) { return new TeamView(t.getId(), t.getName(), t.getDescription(), t.getJoinPolicy()); }
    }
    public record MemberView(long userId, String username, String displayName, String role) {}
    public record RequestView(long id, long userId, String username, String status, Instant createdAt) {}
    public record MyRequestView(long id, long teamId, String status, Instant createdAt) {}
    public record InviteeView(long userId, String username, String displayName) {}
    public record InvitationView(long id, Long inviteeUserId, String username, String email, String status, Instant expiresAt) {}
    public record MyInvitationView(long id, long teamId, String teamName, Instant expiresAt) {}

    @Transactional
    public TeamView create(long userId, String name, String description) {
        requireUser(userId);
        Team team = teams.saveAndFlush(new Team(name.trim(), trim(description)));
        members.save(new TeamMember(team.getId(), userId, "OWNER"));
        bump(userId);
        return TeamView.of(team);
    }
    @Transactional(readOnly = true)
    public Page<TeamView> mine(long userId, int page, int size) {
        requireUser(userId);
        return teams.mine(userId, PageRequest.of(page, size)).map(TeamView::of);
    }
    @Transactional(readOnly = true)
    public Page<TeamView> discover(String query, int page, int size) {
        return teams.discover(query.trim(), PageRequest.of(page, size)).map(TeamView::of);
    }
    @Transactional(readOnly = true)
    public TeamView get(long teamId, long userId) {
        access.member(teamId, userId);
        return TeamView.of(teams.findById(teamId).orElseThrow());
    }
    @Transactional(readOnly = true)
    public List<MemberView> members(long teamId, long userId) {
        access.member(teamId, userId);
        return members.findByTeamIdAndStatusOrderById(teamId, "ACTIVE").stream().map(m -> {
            AppUser u = requireUser(m.getUserId());
            return new MemberView(u.getId(), u.getUsername(), u.getDisplayName(), m.getRole());
        }).toList();
    }
    @Transactional
    public TeamView policy(long teamId, long userId, String policy) {
        Team team = lockTeam(teamId);
        access.owner(teamId, userId);
        if (!"REQUEST".equals(policy) && !"INVITE_ONLY".equals(policy)) throw new IllegalArgumentException("加入策略无效");
        team.setJoinPolicy(policy);
        return TeamView.of(team);
    }
    @Transactional
    public RequestView request(long teamId, long userId) {
        Team team = lockTeam(teamId);
        requireUser(userId);
        if (!"REQUEST".equals(team.getJoinPolicy())) throw new TeamFailure(403, "ACCESS_DENIED", "团队不接受加入申请");
        if (members.findByTeamIdAndUserIdAndStatus(teamId, userId, "ACTIVE").isPresent())
            throw conflict("已是团队成员");
        TeamJoinRequest request = requests.findByTeamIdAndUserId(teamId, userId).orElse(null);
        if (request == null) request = new TeamJoinRequest(teamId, userId);
        else if (!"PENDING".equals(request.getStatus())) request.reopen();
        return view(requests.saveAndFlush(request));
    }
    @Transactional(readOnly = true)
    public List<MyRequestView> myPendingRequests(long userId) {
        requireUser(userId);
        return requests.findByUserIdAndStatusOrderByCreatedAt(userId, "PENDING").stream()
                .map(r -> new MyRequestView(r.getId(), r.getTeamId(), r.getStatus(), r.getCreatedAt())).toList();
    }
    @Transactional
    public void withdraw(long teamId, long userId) {
        lockTeam(teamId);
        TeamJoinRequest request = requests.findByTeamIdAndUserId(teamId, userId)
                .filter(r -> "PENDING".equals(r.getStatus()))
                .orElseThrow(() -> new TeamFailure(404, "JOIN_REQUEST_NOT_FOUND", "申请不存在"));
        request.resolve("WITHDRAWN");
    }
    @Transactional(readOnly = true)
    public List<RequestView> pending(long teamId, long userId) {
        access.owner(teamId, userId);
        return requests.findByTeamIdAndStatusOrderByCreatedAt(teamId, "PENDING").stream().map(this::view).toList();
    }
    @Transactional
    public void decide(long teamId, long userId, long requestId, boolean approve) {
        Team team = lockTeam(teamId);
        access.owner(teamId, userId);
        TeamJoinRequest request = requests.findByIdAndTeamId(requestId, teamId)
                .filter(r -> "PENDING".equals(r.getStatus()))
                .orElseThrow(() -> new TeamFailure(404, "JOIN_REQUEST_NOT_FOUND", "申请不存在"));
        if (approve) {
            if (!"REQUEST".equals(team.getJoinPolicy())) throw conflict("当前加入策略不允许审批");
            requireUser(request.getUserId());
            activate(teamId, request.getUserId());
        }
        request.resolve(approve ? "APPROVED" : "REJECTED");
    }
    @Transactional(readOnly = true)
    public InviteeView lookupInvitee(long teamId, long userId, String identifier) {
        access.owner(teamId, userId);
        AppUser target = findInvitee(identifier);
        if (members.findByTeamIdAndUserIdAndStatus(teamId, target.getId(), "ACTIVE").isPresent())
            throw conflict("用户已是团队成员");
        return new InviteeView(target.getId(), target.getUsername(), target.getDisplayName());
    }
    private AppUser findInvitee(String identifier) {
        boolean byEmail = identifier != null && identifier.contains("@");
        String normalized = IdentityInput.normalize(identifier, byEmail ? 254 : 50);
        if (byEmail && normalized.indexOf('@') != normalized.lastIndexOf('@'))
            throw new IllegalArgumentException("邮箱格式无效");
        return (byEmail ? users.findByNormalizedEmail(normalized) : users.findByNormalizedUsername(normalized))
                .orElseThrow(() -> new TeamFailure(404, "USER_NOT_FOUND", "未找到对应的已注册用户"));
    }
    @Transactional
    public InvitationView invite(long teamId, long userId, long inviteeUserId) {
        lockTeam(teamId);
        access.owner(teamId, userId);
        AppUser target = requireUser(inviteeUserId);
        if (members.findByTeamIdAndUserIdAndStatus(teamId, target.getId(), "ACTIVE").isPresent())
            throw conflict("用户已是团队成员");
        String email = target.getNormalizedEmail();
        List<TeamInvitation> pending = invitations.findPendingForTeamUser(teamId, target.getId());
        for (TeamInvitation prior : pending) {
            if (prior.usable()) throw conflict("已有待处理邀请");
            prior.revoke();
        }
        invitations.flush();
        TeamInvitation invitation = invitations.saveAndFlush(new TeamInvitation(teamId,
                target.getId(), email, Instant.now().plus(7, ChronoUnit.DAYS)));
        return invitationView(invitation);
    }
    @Transactional(readOnly = true)
    public List<InvitationView> invitations(long teamId, long userId) {
        access.owner(teamId, userId);
        return invitations.findByTeamIdOrderByIdDesc(teamId).stream().map(this::invitationView).toList();
    }
    @Transactional(readOnly = true)
    public List<MyInvitationView> myInvitations(long userId) {
        requireUser(userId);
        return invitations.findPendingForUser(userId).stream()
                .filter(TeamInvitation::usable)
                .flatMap(invitation -> teams.findById(invitation.getTeamId()).stream()
                        .filter(team -> "ACTIVE".equals(team.getStatus()))
                        .map(team -> new MyInvitationView(invitation.getId(), team.getId(), team.getName(), invitation.getExpiresAt())))
                .toList();
    }
    @Transactional
    public void revokeInvitation(long teamId, long userId, long invitationId) {
        lockTeam(teamId);
        access.owner(teamId, userId);
        TeamInvitation invitation = invitations.findByIdAndTeamId(invitationId, teamId)
                .orElseThrow(() -> new TeamFailure(404, "INVITATION_NOT_FOUND", "邀请不存在"));
        if (!invitation.usable()) throw gone();
        invitation.revoke();
    }
    @Transactional
    public TeamView accept(long userId, long invitationId) {
        AppUser user = requireUser(userId);
        TeamInvitation invitation = invitations.findById(invitationId).orElseThrow(TeamService::gone);
        Team team = lockTeam(invitation.getTeamId());
        entityManager.refresh(invitation);
        if (!invitation.usable() || !addressedTo(invitation, user)) throw gone();
        if (members.findByTeamIdAndUserIdAndStatus(team.getId(), userId, "ACTIVE").isPresent()) throw gone();
        activate(team.getId(), userId);
        invitation.consume();
        return TeamView.of(team);
    }
    @Transactional
    public void rejectInvitation(long userId, long invitationId) {
        AppUser user = requireUser(userId);
        TeamInvitation invitation = invitations.findById(invitationId).orElseThrow(TeamService::gone);
        lockTeam(invitation.getTeamId());
        entityManager.refresh(invitation);
        if (!invitation.usable() || !addressedTo(invitation, user)) throw gone();
        invitation.reject();
    }
    @Transactional
    public void leave(long teamId, long userId) {
        lockTeam(teamId);
        TeamMember member = access.member(teamId, userId);
        if ("OWNER".equals(member.getRole())) throw conflict("请先转移团队所有权");
        member.remove(); bump(userId);
    }
    @Transactional
    public void remove(long teamId, long ownerId, long memberId) {
        lockTeam(teamId);
        access.owner(teamId, ownerId);
        TeamMember member = access.member(teamId, memberId);
        if ("OWNER".equals(member.getRole())) throw conflict("不能移除当前所有者");
        member.remove(); bump(memberId);
    }
    @Transactional
    public void transfer(long teamId, long ownerId, long nextOwnerId) {
        lockTeam(teamId);
        TeamMember owner = access.owner(teamId, ownerId);
        if (ownerId == nextOwnerId) throw conflict("目标已经是所有者");
        TeamMember next = access.member(teamId, nextOwnerId);
        owner.transferTo("MEMBER"); members.flush(); next.transferTo("OWNER");
        bump(ownerId); bump(nextOwnerId);
    }
    private Team lockTeam(long teamId) {
        return teams.lockActive(teamId).orElseThrow(() -> new TeamFailure(404, "TEAM_NOT_FOUND", "团队不存在"));
    }
    private void activate(long teamId, long userId) {
        requireUser(userId);
        TeamMember old = members.findByTeamIdAndUserId(teamId, userId).orElse(null);
        if (old == null) members.save(new TeamMember(teamId, userId, "MEMBER"));
        else if ("ACTIVE".equals(old.getStatus())) throw conflict("已是团队成员");
        else old.activate();
        invitations.findPendingForTeamUser(teamId, userId)
                .forEach(TeamInvitation::revoke);
        bump(userId);
    }
    private void bump(long userId) {
        if (users.incrementAuthzVersion(userId) != 1) throw new TeamFailure(404, "USER_NOT_FOUND", "用户不存在");
    }
    private AppUser requireUser(long id) {
        return users.findById(id).orElseThrow(() -> new TeamFailure(404, "USER_NOT_FOUND", "用户不存在"));
    }
    private RequestView view(TeamJoinRequest request) {
        AppUser user = requireUser(request.getUserId());
        return new RequestView(request.getId(), user.getId(), user.getUsername(), request.getStatus(), request.getCreatedAt());
    }
    private InvitationView invitationView(TeamInvitation invitation) {
        AppUser user = invitation.getInviteeUserId() == null ? null
                : users.findById(invitation.getInviteeUserId()).orElse(null);
        return new InvitationView(invitation.getId(), invitation.getInviteeUserId(),
                user == null ? null : user.getUsername(), invitation.getEmailNormalized(),
                invitation.getStatus(), invitation.getExpiresAt());
    }
    private static boolean addressedTo(TeamInvitation invitation, AppUser user) {
        return invitation.getInviteeUserId() != null && invitation.getInviteeUserId().equals(user.getId());
    }
    private static String trim(String value) { return value == null || value.isBlank() ? null : value.trim(); }
    private static TeamFailure conflict(String message) { return new TeamFailure(409, "TEAM_STATE_CONFLICT", message); }
    private static TeamFailure gone() { return new TeamFailure(410, "INVITATION_GONE", "邀请无效或已过期"); }
}
