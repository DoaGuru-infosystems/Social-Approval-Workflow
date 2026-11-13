-- Social Media Post Approval System - MySQL Database Schema (Basic MVP)

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

-- 2. Posts Table
CREATE TABLE IF NOT EXISTS `posts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `created_by` INT NOT NULL,
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
  INDEX `idx_posts_status` (`status`),
  INDEX `idx_posts_created_by` (`created_by`)
) ENGINE=InnoDB;

-- 3. Post Revisions Table
CREATE TABLE IF NOT EXISTS `post_revisions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `post_id` INT NOT NULL,
  `revision_number` INT NOT NULL DEFAULT 1,
  `caption` TEXT NULL,
  `image_path` VARCHAR(255) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON DELETE CASCADE,
  INDEX `idx_revisions_post` (`post_id`, `revision_number`)
) ENGINE=InnoDB;

-- 4. Post Approvals Table
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

-- 5. AI Check Results Table
CREATE TABLE IF NOT EXISTS `ai_check_results` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `post_id` INT NOT NULL,
  `revision_id` INT NULL,
  `spelling_issues` JSON NULL,
  `ocr_extracted_text` TEXT NULL,
  `ocr_issues` JSON NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`revision_id`) REFERENCES `post_revisions`(`id`) ON DELETE SET NULL,
  INDEX `idx_ai_check_post` (`post_id`)
) ENGINE=InnoDB;
