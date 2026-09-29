package com.webeditor.team.application;

import com.webeditor.identity.application.IdentityInput;
import com.webeditor.identity.domain.AppUser;
import com.webeditor.identity.repository.AppUserRepository;
import com.webeditor.team.domain.*;
import com.webeditor.team.repository.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import java.util.Base64;
import jakarta.persistence.EntityManager;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TeamService {
    private static final SecureRandom RANDOM = new SecureRandom();
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
    public record InvitationView(long id, String email, String status, Instant expiresAt) {}
    public record IssuedInvitation(long id, String token, Instant expiresAt) {}

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
    @Transactional
    public IssuedInvitation invite(long teamId, long userId, String email) {
        lockTeam(teamId);
        access.owner(teamId, userId);
        String normalized = IdentityInput.normalize(email, 254);
        if (!normalized.contains("@")) throw new IllegalArgumentException("邮箱格式无效");
        byte[] secret = new byte[32]; RANDOM.nextBytes(secret);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
        TeamInvitation invitation = invitations.saveAndFlush(new TeamInvitation(teamId, normalized, hash(token),
                Instant.now().plus(7, ChronoUnit.DAYS)));
        return new IssuedInvitation(invitation.getId(), token, invitation.getExpiresAt());
    }
    @Transactional(readOnly = true)
    public List<InvitationView> invitations(long teamId, long userId) {
        access.owner(teamId, userId);
        return invitations.findByTeamIdOrderByIdDesc(teamId).stream()
                .map(i -> new InvitationView(i.getId(), i.getEmailNormalized(), i.getStatus(), i.getExpiresAt())).toList();
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
    public TeamView accept(long userId, String token) {
        AppUser user = requireUser(userId);
        TeamInvitation invitation = invitations.findByTokenHash(hash(token)).orElseThrow(TeamService::gone);
        Team team = lockTeam(invitation.getTeamId());
        entityManager.refresh(invitation);
        if (!invitation.usable() || user.getNormalizedEmail() == null
                || !user.getNormalizedEmail().equals(invitation.getEmailNormalized())) throw gone();
        if (members.findByTeamIdAndUserIdAndStatus(team.getId(), userId, "ACTIVE").isPresent()) throw gone();
        activate(team.getId(), userId);
        invitation.consume();
        return TeamView.of(team);
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
        TeamMember old = members.findByTeamIdAndUserId(teamId, userId).orElse(null);
        if (old == null) members.save(new TeamMember(teamId, userId, "MEMBER"));
        else if ("ACTIVE".equals(old.getStatus())) throw conflict("已是团队成员");
        else old.activate();
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
    private static String trim(String value) { return value == null || value.isBlank() ? null : value.trim(); }
    private static TeamFailure conflict(String message) { return new TeamFailure(409, "TEAM_STATE_CONFLICT", message); }
    private static TeamFailure gone() { return new TeamFailure(410, "INVITATION_GONE", "邀请无效或已过期"); }
    private static String hash(String token) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
}
