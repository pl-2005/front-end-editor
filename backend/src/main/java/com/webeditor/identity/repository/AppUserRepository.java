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
    @Modifying
    @Query("update AppUser u set u.authzVersion = u.authzVersion + 1 where u.id = :id")
    int incrementAuthzVersion(@Param("id") long id);
    Optional<AppUser> findByNormalizedUsername(String username);
    Optional<AppUser> findByNormalizedEmail(String email);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from AppUser u where u.id = :id")
    Optional<AppUser> lockById(@Param("id") long id);
}
