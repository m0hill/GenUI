CREATE TABLE `todos` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
