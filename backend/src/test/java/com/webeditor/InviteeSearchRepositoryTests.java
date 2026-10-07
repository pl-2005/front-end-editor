package com.webeditor;

import static org.assertj.core.api.Assertions.assertThat;

import com.webeditor.identity.domain.AppUser;
import com.webeditor.identity.repository.AppUserRepository;
import com.webeditor.team.domain.Team;
import com.webeditor.team.domain.TeamMember;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.data.domain.PageRequest;

/** 使用根 .env 配置的本机 MySQL；测试记录在事务结束时回滚。 */
@EnabledIfEnvironmentVariable(named = "DB_URL", matches = "jdbc:mysql:.*")
@DataJpaTest(showSql = false, properties = {
        "spring.datasource.url=${DB_URL}",
        "spring.datasource.username=${DB_USERNAME}",
        "spring.datasource.password=${DB_PASSWORD}",
        "spring.flyway.enabled=false", "spring.sql.init.mode=never",
        "spring.jpa.hibernate.ddl-auto=validate", "spring.jpa.show-sql=false" })
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class InviteeSearchRepositoryTests {
    @Autowired AppUserRepository users;
    @Autowired TestEntityManager entities;

    @Test void matchesPartialUsernamesAndEmailsButExcludesActiveMembers() {
        String keyword = keyword();
        Team team = entities.persistAndFlush(new Team("Search test", null));
        AppUser byName = create(keyword + "alice", null);
        AppUser byEmail = create(keyword() + "other", "prefix" + keyword + "@example.test");
        AppUser member = create(keyword + "member", null);
        entities.persistAndFlush(new TeamMember(team.getId(), member.getId(), "MEMBER"));
        assertThat(users.searchInvitees(team.getId(), keyword, PageRequest.of(0, 20)))
                .extracting(AppUser::getId).containsExactlyInAnyOrder(byName.getId(), byEmail.getId());
        assertThat(users.searchInvitees(team.getId(), "prefix" + keyword, PageRequest.of(0, 20)))
                .extracting(AppUser::getId).containsExactly(byEmail.getId());
    }

    @Test void treatsWildcardCharactersLiterallyAndLimitsResults() {
        String keyword = keyword();
        Team team = entities.persistAndFlush(new Team("Search test", null));
        AppUser literal = create(keyword + "_literal", null);
        create(keyword + "xliteral", null);
        assertThat(users.searchInvitees(team.getId(), keyword + "_", PageRequest.of(0, 20)))
                .extracting(AppUser::getId).containsExactly(literal.getId());
        for (int i = 0; i < 21; i++) create(keyword + "result" + i, null);
        assertThat(users.searchInvitees(team.getId(), keyword, PageRequest.of(0, 20))).hasSize(20);
        assertThat(users.searchInvitees(team.getId(), keyword + "absent", PageRequest.of(0, 20))).isEmpty();
    }

    private String keyword() {
        return "fuzzy" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    private AppUser create(String username, String email) {
        return users.saveAndFlush(new AppUser(username, username, email, email,
                "{noop}unused", username, "#2563eb"));
    }
}
