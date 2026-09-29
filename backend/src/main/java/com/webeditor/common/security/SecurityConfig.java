package com.webeditor.common.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import com.webeditor.identity.application.AuthFailure;
import com.webeditor.identity.application.AuthService;

@Configuration
public class SecurityConfig {
    @Bean FilterRegistrationBean<JwtAuthenticationFilter> jwtFilterRegistration(JwtAuthenticationFilter filter) {
        FilterRegistrationBean<JwtAuthenticationFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }
    @Bean FilterRegistrationBean<JsonAuthenticationFilter> jsonAuthenticationFilterRegistration(JsonAuthenticationFilter filter) {
        FilterRegistrationBean<JsonAuthenticationFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }
    @Bean AuthenticationManager authenticationManager(AuthService auth) {
        return authentication -> {
            try {
                var credentials = auth.login(authentication.getName(), (String) authentication.getCredentials());
                return new UsernamePasswordAuthenticationToken(credentials, null, java.util.List.of());
            } catch (AuthFailure e) {
                if (e.status() == 401) throw new BadCredentialsException("Invalid credentials");
                throw e;
            }
        };
    }
    @Bean PasswordEncoder passwordEncoder() { return PasswordEncoderFactories.createDelegatingPasswordEncoder(); }
    @Bean SecurityFilterChain securityFilterChain(HttpSecurity http, JwtAuthenticationFilter jwt,
            JsonAuthenticationFilter json, SecurityErrors errors) throws Exception {
        http.csrf(csrf -> csrf.disable()).cors(cors -> cors.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .formLogin(form -> form.disable()).httpBasic(basic -> basic.disable())
                .logout(logout -> logout.disable())
                .exceptionHandling(ex -> ex.authenticationEntryPoint((request, response, e) -> errors.write(request, response, 401, "AUTHENTICATION_REQUIRED"))
                        .accessDeniedHandler((request, response, e) -> errors.write(request, response, 403, "ACCESS_DENIED")))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/health", "/api/health/readiness", "/api/teams/discover").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/register", "/api/auth/login", "/api/auth/refresh").permitAll()
                        .requestMatchers("/api/projects", "/api/projects/**").denyAll()
                        .requestMatchers("/api/**").authenticated().anyRequest().denyAll())
                .addFilterBefore(jwt, AnonymousAuthenticationFilter.class)
                .addFilterBefore(json, AnonymousAuthenticationFilter.class);
        return http.build();
    }
}
