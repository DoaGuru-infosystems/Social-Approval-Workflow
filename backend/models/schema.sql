-- Social Media Post Approval System - MySQL Database Schema (Multi-Client Edition)

CREATE DATABASE IF NOT EXISTS `social_approval_db`
DEFAULT CHARACTER SET utf8mb4
DEFAULT COLLATE utf8mb4_unicode_ci;

USE `social_approval_db`;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(150) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('admin', 'manager', 'smo') NOT NULL DEFAULT 'smo',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_users_role` (`role`)
) ENGINE=InnoDB;

-- 2. Clients Table
CREATE TABLE IF NOT EXISTS `clients` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(150) NOT NULL,
  `primary_phone` VARCHAR(30) NULL,
  `alternate_phone` VARCHAR(30) NULL,
  `address` TEXT NULL,
  `gmb_url` VARCHAR(500) NULL,
  `gmb_place_id` VARCHAR(200) NULL,
  `gmb_snapshot` JSON NULL,
  `gmb_last_synced_at` DATETIME NULL,
  `gmb_auto_whitelist` JSON NULL,
  `created_by_admin_id` INT NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`created_by_admin_id`) REFERENCES `users`(`id`),
  INDEX `idx_clients_is_active` (`is_active`)
) ENGINE=InnoDB;

-- 3. Client Brand Guidelines Table
CREATE TABLE IF NOT EXISTS `client_brand_guidelines` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `client_id` INT NOT NULL UNIQUE,
  `whitelist_words` JSON NULL,
  `banned_words` JSON NULL,
  `mandatory_phrases` JSON NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 4. Social Accounts (Client-Scoped) Table
CREATE TABLE IF NOT EXISTS `social_accounts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `client_id` INT NOT NULL,
  `platform` ENUM('instagram', 'facebook') NOT NULL,
  `account_name` VARCHAR(150) NOT NULL,
  `platform_account_id` VARCHAR(100) NOT NULL,
  `connected_by_admin_id` INT NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`connected_by_admin_id`) REFERENCES `users`(`id`),
  INDEX `idx_social_client` (`client_id`, `platform`)
) ENGINE=InnoDB;

-- 5. Social Account Tokens (Encrypted) Table
CREATE TABLE IF NOT EXISTS `social_account_tokens` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `social_account_id` INT NOT NULL UNIQUE,
  `access_token` TEXT NOT NULL,
  `expires_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`social_account_id`) REFERENCES `social_accounts`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 6. Posts Table (Client-Scoped with Title)
CREATE TABLE IF NOT EXISTS `posts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `created_by` INT NOT NULL,
  `client_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `caption` TEXT NULL,
  `image_path` VARCHAR(255) NULL,
  `status` ENUM(
    'draft',
    'ai_checking',
    'pending_manager',
    'pending_admin',
    'admin_approved',
    'ready_to_publish',
    'completed',
    'changes_requested',
    'rejected'
  ) NOT NULL DEFAULT 'ai_checking',
  `platform` ENUM('instagram', 'facebook') NULL DEFAULT NULL,
  `manual_publish_url` VARCHAR(500) NULL DEFAULT NULL,
  `recheck_count` INT NOT NULL DEFAULT 0,
  `manual_review_required` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
  INDEX `idx_posts_status` (`status`),
  INDEX `idx_posts_created_by` (`created_by`),
  INDEX `idx_posts_client` (`client_id`)
) ENGINE=InnoDB;

-- 7. Post Revisions Table
CREATE TABLE IF NOT EXISTS `post_revisions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `post_id` INT NOT NULL,
  `revision_number` INT NOT NULL DEFAULT 1,
  `title` VARCHAR(255) NULL,
  `caption` TEXT NULL,
  `image_path` VARCHAR(255) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON DELETE CASCADE,
  INDEX `idx_revisions_post` (`post_id`, `revision_number`)
) ENGINE=InnoDB;

-- 8. Post Approvals Table
CREATE TABLE IF NOT EXISTS `post_approvals` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `post_id` INT NOT NULL,
  `revision_id` INT NULL,
  `approver_id` INT NOT NULL,
  `role` ENUM('admin', 'manager') NOT NULL,
  `action` ENUM('approved', 'rejected', 'changes_requested') NOT NULL,
  `comment` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`revision_id`) REFERENCES `post_revisions`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`approver_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX `idx_approvals_post` (`post_id`)
) ENGINE=InnoDB;

-- 9. AI Check Results Table
CREATE TABLE IF NOT EXISTS `ai_check_results` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `post_id` INT NOT NULL,
  `revision_id` INT NULL,
  `spelling_issues` JSON NULL,
  `ocr_extracted_text` TEXT NULL,
  `ocr_issues` JSON NULL,
  `ocr_confidence` DECIMAL(5,2) NULL,
  `ocr_unreliable` BOOLEAN NOT NULL DEFAULT FALSE,
  `image_status` VARCHAR(20) NOT NULL DEFAULT 'completed',
  `text_status` VARCHAR(20) NOT NULL DEFAULT 'completed',
  `image_error` TEXT NULL,
  `banned_words_found` JSON NULL,
  `missing_mandatory_phrases` JSON NULL,
  `brand_identity_check` JSON NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`revision_id`) REFERENCES `post_revisions`(`id`) ON DELETE SET NULL,
  INDEX `idx_ai_check_post` (`post_id`)
) ENGINE=InnoDB;
