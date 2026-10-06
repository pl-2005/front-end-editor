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
    /**
     * 禁用 JWT 过滤器的 Servlet 自动注册，使其只在安全过滤链中执行。
     *
     * @param filter 待关闭 Servlet 自动注册的安全过滤器
     */
    @Bean FilterRegistrationBean<JwtAuthenticationFilter> jwtFilterRegistration(JwtAuthenticationFilter filter) {
        FilterRegistrationBean<JwtAuthenticationFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }
    /**
     * 禁用 JSON 登录过滤器的 Servlet 自动注册，避免在安全过滤链外重复执行。
     *
     * @param filter 待关闭 Servlet 自动注册的安全过滤器
     */
    @Bean FilterRegistrationBean<JsonAuthenticationFilter> jsonAuthenticationFilterRegistration(JsonAuthenticationFilter filter) {
        FilterRegistrationBean<JsonAuthenticationFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }
    /**
     * 将用户名密码认证委托给认证服务，并将 401 故障转换为 Spring 凭据错误。
     *
     * @param auth 认证服务
     */
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
    /**
     * 创建带算法标识的委托密码编码器，兼容已有摘要并支持升级。
     */
    @Bean PasswordEncoder passwordEncoder() { return PasswordEncoderFactories.createDelegatingPasswordEncoder(); }
    /**
     * 配置无状态安全链、公开接口和统一错误处理；旧项目 API 禁用，内部协作接口由控制器单独验证 HMAC。
     *
     * @param http 安全过滤链配置器
     * @param jwt JWT 认证过滤器
     * @param json JSON 登录过滤器
     * @param errors 统一认证错误写入器
     */
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
                        // The internal controller authenticates bounded raw bodies with its separate HMAC key.
                        .requestMatchers(HttpMethod.GET, "/internal/collaboration/operations/*").permitAll()
                        .requestMatchers("/internal/collaboration/projects/**", "/internal/collaboration/tickets/consume",
                                "/internal/collaboration/connections/revalidate").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/projects/*/collab-ticket").authenticated()
                        .requestMatchers("/api/projects", "/api/projects/**").denyAll()
                        .requestMatchers("/api/**").authenticated().anyRequest().denyAll())
                .addFilterBefore(jwt, AnonymousAuthenticationFilter.class)
                .addFilterBefore(json, AnonymousAuthenticationFilter.class);
        return http.build();
    }
}
