package com.webeditor;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.webeditor.identity.application.AuthRateLimiter;
import com.webeditor.identity.application.TokenService;
import com.webeditor.identity.domain.AppUser;
import com.webeditor.identity.repository.AppUserRepository;
import com.webeditor.project.domain.Project;
import com.webeditor.project.repository.ProjectRepository;
import com.webeditor.team.application.TeamFailure;
import com.webeditor.team.application.TeamService;
import com.webeditor.team.repository.TeamMemberRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest @AutoConfigureMockMvc
class TeamAccessTests {
    @Autowired TeamService teams;
    @Autowired AppUserRepository users;
    @Autowired TeamMemberRepository members;
    @Autowired ProjectRepository projects;
    @Autowired TokenService tokens;
    @Autowired MockMvc mvc;
    @MockitoBean AuthRateLimiter limiter;

    @Test void onlyOwnerCanEditTeamMetadataAndBlankDescriptionCanBeCleared() throws Exception {
        AppUser owner = user("owner");
        AppUser member = user("member");
        AppUser stranger = user("stranger");
        long teamId = teams.create(owner.getId(), "原团队", "原描述").id();
        teams.decide(teamId, owner.getId(), teams.request(teamId, member.getId()).id(), true);
        mvc.perform(put("/api/teams/" + teamId).header("Authorization", bearer(member))
                .contentType("application/json").content("{\"name\":\"非法修改\",\"description\":null}"))
                .andExpect(status().isForbidden());
        mvc.perform(put("/api/teams/" + teamId).header("Authorization", bearer(stranger))
                .contentType("application/json").content("{\"name\":\"非法修改\",\"description\":null}"))
                .andExpect(status().isNotFound());
        assertThat(teams.get(teamId, owner.getId()).name()).isEqualTo("原团队");
        mvc.perform(put("/api/teams/" + teamId).header("Authorization", bearer(owner))
                .contentType("application/json").content("{\"name\":\" 新团队 \",\"description\":\" 新描述 \"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.name").value("新团队"))
                .andExpect(jsonPath("$.data.description").value("新描述"))
                .andExpect(jsonPath("$.data.role").value("OWNER"));
        mvc.perform(put("/api/teams/" + teamId).header("Authorization", bearer(owner))
                .contentType("application/json").content("{\"name\":\"   \",\"description\":null}"))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/api/teams/" + teamId).header("Authorization", bearer(owner))
                .contentType("application/json").content("{\"name\":\"新团队\",\"description\":\"" + "x".repeat(501) + "\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/api/teams/" + teamId).header("Authorization", bearer(owner))
                .contentType("application/json").content("{\"name\":\"新团队\",\"description\":\"   \"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.description").isEmpty());
        assertThat(teams.get(teamId, owner.getId()).description()).isNull();
        assertThat(teams.mine(owner.getId(), 0, 100).getContent())
                .anySatisfy(team -> { assertThat(team.id()).isEqualTo(teamId); assertThat(team.role()).isEqualTo("OWNER"); });
        assertThat(teams.mine(member.getId(), 0, 100).getContent())
                .anySatisfy(team -> { assertThat(team.id()).isEqualTo(teamId); assertThat(team.role()).isEqualTo("MEMBER"); });
    }

    @Test void usernameInvitationIsVisibleOnlyToRecipientAndConsumedOnce() throws Exception {
        AppUser owner = user("owner");
        AppUser member = user("member");
        AppUser stranger = user("stranger");
        long teamId = teams.create(owner.getId(), "邀请测试", null).id();
        assertThat(teams.lookupInvitee(teamId, owner.getId(), member.getUsername()).userId()).isEqualTo(member.getId());
        var invite = teams.invite(teamId, owner.getId(), member.getId());
        assertThat(invite.username()).isEqualTo(member.getUsername());
        assertThat(invite.inviteeUserId()).isEqualTo(member.getId());
        mvc.perform(get("/api/teams/invitations/me").header("Authorization", bearer(member)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data[0].id").value(invite.id()));
        mvc.perform(get("/api/teams/invitations/me").header("Authorization", bearer(stranger)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data").isEmpty());
        assertThatThrownBy(() -> teams.accept(stranger.getId(), invite.id()))
                .isInstanceOfSatisfying(TeamFailure.class, e -> assertThat(e.status()).isEqualTo(410));
        mvc.perform(post("/api/teams/invitations/{id}/accept", invite.id())
                .header("Authorization", bearer(member))).andExpect(status().isOk());
        assertThat(members.findByTeamIdAndUserId(teamId, member.getId()).orElseThrow().getRole()).isEqualTo("MEMBER");
        assertThatThrownBy(() -> teams.accept(member.getId(), invite.id()))
                .isInstanceOfSatisfying(TeamFailure.class, e -> assertThat(e.status()).isEqualTo(410));
        assertThat(users.findById(member.getId()).orElseThrow().getAuthzVersion()).isEqualTo(1);
    }

    @Test void unknownUserCannotBeInvitedAndRegisteredEmailCanBeRejected() throws Exception {
        AppUser owner = user("owner");
        AppUser stranger = user("stranger");
        long teamId = teams.create(owner.getId(), "已注册邀请", null).id();
        String email = "invited" + UUID.randomUUID().toString().substring(0, 12) + "@example.test";
        assertThatThrownBy(() -> teams.lookupInvitee(teamId, owner.getId(), email))
                .isInstanceOfSatisfying(TeamFailure.class, e -> { assertThat(e.status()).isEqualTo(404); assertThat(e.code()).isEqualTo("USER_NOT_FOUND"); });
        assertThatThrownBy(() -> teams.lookupInvitee(teamId, owner.getId(), "missing" + UUID.randomUUID().toString().substring(0, 8)))
                .isInstanceOfSatisfying(TeamFailure.class, e -> assertThat(e.status()).isEqualTo(404));
        assertThat(teams.invitations(teamId, owner.getId())).isEmpty();
        mvc.perform(get("/api/teams/{id}/invitees/lookup", teamId).param("identifier", email)
                .header("Authorization", bearer(owner))).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
        mvc.perform(post("/api/teams/{id}/invitations", teamId).header("Authorization", bearer(owner))
                .contentType("application/json").content("{\"userId\":9223372036854775807}"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
        assertThat(teams.invitations(teamId, owner.getId())).isEmpty();
        String name = "invited" + UUID.randomUUID().toString().substring(0, 12);
        AppUser recipient = users.saveAndFlush(new AppUser(name, name, email, email, "{bcrypt}unused", name, "#123456"));
        mvc.perform(get("/api/teams/{id}/invitees/lookup", teamId).param("identifier", email)
                .header("Authorization", bearer(owner))).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.userId").value(recipient.getId()));
        mvc.perform(get("/api/teams/{id}/invitees/lookup", teamId).param("identifier", email)
                .header("Authorization", bearer(stranger))).andExpect(status().isNotFound());
        var invite = teams.invite(teamId, owner.getId(), recipient.getId());
        assertThat(invite.inviteeUserId()).isEqualTo(recipient.getId());
        assertThatThrownBy(() -> teams.invite(teamId, owner.getId(), recipient.getId()))
                .isInstanceOfSatisfying(TeamFailure.class, e -> assertThat(e.status()).isEqualTo(409));
        assertThatThrownBy(() -> teams.rejectInvitation(stranger.getId(), invite.id()))
                .isInstanceOfSatisfying(TeamFailure.class, e -> assertThat(e.status()).isEqualTo(410));
        assertThat(teams.myInvitations(recipient.getId())).extracting(TeamService.MyInvitationView::id).contains(invite.id());
        mvc.perform(post("/api/teams/invitations/{id}/reject", invite.id())
                .header("Authorization", bearer(recipient))).andExpect(status().isNoContent());
        assertThat(teams.myInvitations(recipient.getId())).isEmpty();
        var next = teams.invite(teamId, owner.getId(), recipient.getId());
        teams.accept(recipient.getId(), next.id());
        assertThat(members.findByTeamIdAndUserId(teamId, recipient.getId())).isPresent();
    }

    @Test void ownerCanRevokeEmailInvitationAndMemberCannotInvite() {
        AppUser owner = user("owner");
        AppUser member = user("member");
        AppUser recipient = user("recipient");
        long teamId = teams.create(owner.getId(), "撤销邀请", null).id();
        teams.decide(teamId, owner.getId(), teams.request(teamId, member.getId()).id(), true);
        var invite = teams.invite(teamId, owner.getId(), recipient.getId());
        assertThatThrownBy(() -> teams.invite(teamId, member.getId(), recipient.getId()))
                .isInstanceOfSatisfying(TeamFailure.class, e -> assertThat(e.status()).isEqualTo(403));
        teams.revokeInvitation(teamId, owner.getId(), invite.id());
        assertThat(teams.myInvitations(recipient.getId())).isEmpty();
        assertThatThrownBy(() -> teams.accept(recipient.getId(), invite.id()))
                .isInstanceOfSatisfying(TeamFailure.class, e -> assertThat(e.status()).isEqualTo(410));
    }

    @Test void requestTransferAndRemovalImmediatelyAffectAccess() throws Exception {
        AppUser owner = user("owner");
        AppUser member = user("member");
        long teamId = teams.create(owner.getId(), "申请测试", null).id();
        var request = teams.request(teamId, member.getId());
        assertThatThrownBy(() -> teams.get(teamId, member.getId()))
                .isInstanceOfSatisfying(TeamFailure.class, e -> assertThat(e.status()).isEqualTo(404));
        mvc.perform(get("/api/teams/{id}/members", teamId).header("Authorization", bearer(member)))
                .andExpect(status().isNotFound());
        teams.decide(teamId, owner.getId(), request.id(), true);
        mvc.perform(get("/api/teams/{id}/members", teamId).header("Authorization", bearer(member)))
                .andExpect(status().isOk());
        mvc.perform(put("/api/teams/{id}/join-policy", teamId).header("Authorization", bearer(member))
                        .contentType("application/json").content("{\"joinPolicy\":\"INVITE_ONLY\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        assertThatThrownBy(() -> teams.leave(teamId, owner.getId()))
                .isInstanceOfSatisfying(TeamFailure.class, e -> assertThat(e.status()).isEqualTo(409));
        teams.transfer(teamId, owner.getId(), member.getId());
        teams.leave(teamId, owner.getId());
        mvc.perform(get("/api/teams/{id}/members", teamId).header("Authorization", bearer(owner)))
                .andExpect(status().isNotFound());
        assertThat(members.findByTeamIdAndUserId(teamId, member.getId()).orElseThrow().getRole()).isEqualTo("OWNER");
    }

    @Test void applicantCanSeeAndWithdrawOwnPendingRequest() throws Exception {
        AppUser owner = user("owner");
        AppUser applicant = user("applicant");
        AppUser other = user("other");
        long teamId = teams.create(owner.getId(), "申请状态测试", null).id();
        teams.request(teamId, applicant.getId());
        mvc.perform(get("/api/teams/join-requests/me").header("Authorization", bearer(applicant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].teamId").value(teamId));
        mvc.perform(get("/api/teams/join-requests/me").header("Authorization", bearer(other)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").isEmpty());
        teams.withdraw(teamId, applicant.getId());
        mvc.perform(get("/api/teams/join-requests/me").header("Authorization", bearer(applicant)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").isEmpty());
    }

    @Test void legacyProjectAndOldApiStayClosed() throws Exception {
        AppUser owner = user("owner");
        long teamId = teams.create(owner.getId(), "隔离测试", null).id();
        Project legacy = projects.saveAndFlush(new Project("旧项目", null, "vanilla", "/index.html"));
        mvc.perform(get("/api/teams/{id}/projects/{projectId}", teamId, legacy.getId())
                        .header("Authorization", bearer(owner)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/teams/{id}/projects", teamId).header("Authorization", bearer(owner)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.totalElements").value(0));
        mvc.perform(get("/api/projects/{id}", legacy.getId()).header("Authorization", bearer(owner)))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/projects").header("Authorization", bearer(owner))
                        .contentType("application/json").content("{\"name\":\"bad\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/teams/{id}/projects", teamId).header("Authorization", bearer(owner))
                        .contentType("application/json").content("{\"name\":\"early\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("COLLAB_CREATION_DISABLED"));
    }

    private AppUser user(String prefix) {
        String name = prefix + UUID.randomUUID().toString().substring(0, 12);
        return users.saveAndFlush(new AppUser(name, name, name + "@example.test", name + "@example.test",
                "{bcrypt}unused", name, "#123456"));
    }
    private String bearer(AppUser user) { return "Bearer " + tokens.issue(user); }
}
