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

    @Test void invitationIsBoundToEmailAndConsumedOnce() {
        AppUser owner = user("owner");
        AppUser member = user("member");
        AppUser stranger = user("stranger");
        long teamId = teams.create(owner.getId(), "邀请测试", null).id();
        var invite = teams.invite(teamId, owner.getId(), member.getEmail());
        assertThatThrownBy(() -> teams.accept(stranger.getId(), invite.token()))
                .isInstanceOfSatisfying(TeamFailure.class, e -> assertThat(e.status()).isEqualTo(410));
        teams.accept(member.getId(), invite.token());
        assertThat(members.findByTeamIdAndUserId(teamId, member.getId()).orElseThrow().getRole()).isEqualTo("MEMBER");
        assertThatThrownBy(() -> teams.accept(member.getId(), invite.token()))
                .isInstanceOfSatisfying(TeamFailure.class, e -> assertThat(e.status()).isEqualTo(410));
        assertThat(users.findById(member.getId()).orElseThrow().getAuthzVersion()).isEqualTo(1);
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
                .andExpect(status().isMethodNotAllowed());
    }

    private AppUser user(String prefix) {
        String name = prefix + UUID.randomUUID().toString().substring(0, 12);
        return users.saveAndFlush(new AppUser(name, name, name + "@example.test", name + "@example.test",
                "{bcrypt}unused", name, "#123456"));
    }
    private String bearer(AppUser user) { return "Bearer " + tokens.issue(user); }
}
