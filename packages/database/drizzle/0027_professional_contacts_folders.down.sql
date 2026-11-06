-- Rollback for 0027_professional_contacts_folders.

ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_folder_id_fkey";
DROP INDEX IF EXISTS "documents_folder_idx";
ALTER TABLE "documents" DROP COLUMN IF EXISTS "folder_id";

ALTER TABLE "document_folders" DROP CONSTRAINT IF EXISTS "document_folders_parent_matter_fk";
DROP TABLE IF EXISTS "document_folders";
DROP TABLE IF EXISTS "client_contacts";
DROP INDEX IF EXISTS "contacts_id_org_uidx";
DROP TABLE IF EXISTS "contacts";
