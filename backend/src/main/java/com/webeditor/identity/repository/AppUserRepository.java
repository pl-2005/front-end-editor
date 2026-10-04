package com.webeditor.identity.repository;

import com.webeditor.identity.domain.AppUser;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.repository.query.Param;

public interface AppUserRepository extends JpaRepository<AppUser, Long> {
    /**
     * 原子递增用户授权版本，返回受影响行数。
     *
     * @param id 用户 ID
     */
    @Modifying
    @Query("update AppUser u set u.authzVersion = u.authzVersion + 1 where u.id = :id")
    int incrementAuthzVersion(@Param("id") long id);
    /**
     * 按规范化用户名查询用户，不存在时返回空 Optional。
     *
     * @param username 用户名
     */
    Optional<AppUser> findByNormalizedUsername(String username);
    /**
     * 按规范化邮箱查询用户，不存在时返回空 Optional。
     *
     * @param email 邮箱
     */
    Optional<AppUser> findByNormalizedEmail(String email);
    /**
     * 以悲观写锁读取用户，供密码或会话版本变更使用。
     *
     * @param id 用户 ID
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from AppUser u where u.id = :id")
    Optional<AppUser> lockById(@Param("id") long id);
}
