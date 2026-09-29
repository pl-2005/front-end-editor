CREATE TABLE app_user (
    id BIGINT NOT NULL AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL,
    normalized_username VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    email VARCHAR(254) NULL,
    normalized_email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    avatar_color CHAR(7) NOT NULL,
    authz_version BIGINT NOT NULL DEFAULT 0,
    password_changed_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_app_user_normalized_username UNIQUE (normalized_username),
    CONSTRAINT uk_app_user_normalized_email UNIQUE (normalized_email),
    CONSTRAINT chk_app_user_authz_version CHECK (authz_version >= 0),
    CONSTRAINT chk_app_user_email_pair CHECK (
      (email IS NULL AND normalized_email IS NULL) OR
      (email IS NOT NULL AND normalized_email IS NOT NULL)
    )
);
