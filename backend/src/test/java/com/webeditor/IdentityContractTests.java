package com.webeditor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doThrow;
import static org.mockito.ArgumentMatchers.anyString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.webeditor.identity.application.AuthRateLimiter;
import com.webeditor.identity.application.IdentityInput;
import com.webeditor.identity.application.RefreshStore;
import com.webeditor.identity.repository.AppUserRepository;
import com.webeditor.common.security.JwtKeys;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class IdentityContractTests {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired AppUserRepository users;
    @Autowired JwtDecoder decoder;
    @MockitoBean AuthRateLimiter limiter;
    @MockitoBean RefreshStore refresh;

    @Test void normalizationAndPasswordByteBoundary() {
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> new JwtKeys().jwtSigningKey("short"))
                .isInstanceOf(IllegalStateException.class);
        assertThat(IdentityInput.normalize("  Ａlice  ", 50)).isEqualTo("alice");
        assertThat(IdentityInput.normalize("İ", 50)).isEqualTo("i̇");
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> IdentityInput.validatePassword("汉".repeat(25)))
                .isInstanceOf(IllegalArgumentException.class);
        IdentityInput.validatePassword("汉".repeat(24));
    }

    @Test void loginFilterReturnsJsonAndIntegerRetryAfter() throws Exception {
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"login\":\"a\",\"password\":\"b\",\"role\":\"OWNER\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("x".repeat(8193)))
                .andExpect(status().isBadRequest());
        doThrow(new AuthRateLimiter.Limited(7)).when(limiter).check(anyString(), anyString(), anyString());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"login\":\"a\",\"password\":\"b\"}"))
                .andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After", "7"))
                .andExpect(jsonPath("$.code").value("AUTH_RATE_LIMITED"));
    }

    @Test void registerLoginAndRevocation() throws Exception {
        String username = "alice-contract";
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"" + username + "\",\"password\":\"correct-horse-battery\",\"teamRole\":\"OWNER\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"" + username + "\",\"password\":\"correct-horse-battery\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.data.passwordHash").doesNotExist());
        mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"" + username + "\",\"password\":\"correct-horse-battery\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("USERNAME_ALREADY_EXISTS"));
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"login\":\"" + username + "\",\"password\":\"wrong-password\"}"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
        when(refresh.create(anyLong(), anyLong())).thenReturn("test-refresh");
        var login = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"login\":\"" + username + "\",\"password\":\"correct-horse-battery\"}"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.user.passwordHash").doesNotExist()).andReturn();
        String token = mapper.readTree(login.getResponse().getContentAsByteArray()).path("data").path("accessToken").asText();
        assertThat(decoder.decode(token).getHeaders().get("alg")).isEqualTo("HS256");
        assertThat(decoder.decode(token).getHeaders()).doesNotContainKey("kid");
        mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.username").value(username));
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token)
                .header("Authorization", "Bearer " + token)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/projects").header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/auth/logout").header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
        var secondLogin = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"login\":\"" + username + "\",\"password\":\"correct-horse-battery\"}"))
                .andExpect(status().isOk()).andReturn();
        String secondToken = mapper.readTree(secondLogin.getResponse().getContentAsByteArray()).path("data").path("accessToken").asText();
        mvc.perform(put("/api/auth/password").header("Authorization", "Bearer " + secondToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"currentPassword\":\"correct-horse-battery\",\"newPassword\":\"new-horse-battery\"}"))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + secondToken))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"login\":\"" + username + "\",\"password\":\"correct-horse-battery\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"login\":\"" + username + "\",\"password\":\"new-horse-battery\"}"))
                .andExpect(status().isOk());
    }
}
