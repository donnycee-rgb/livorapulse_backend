-- Store every email in lowercase without surrounding spaces, so sign-in and
-- password reset find the account however the address is typed.
-- An address that would clash with another account (same address in
-- different capitals) is left as it is; lookups ignore case, so it still works.
UPDATE "User" u
SET "email" = LOWER(TRIM(u."email"))
WHERE u."email" <> LOWER(TRIM(u."email"))
  AND NOT EXISTS (
    SELECT 1 FROM "User" o
    WHERE o."id" <> u."id" AND LOWER(TRIM(o."email")) = LOWER(TRIM(u."email"))
  );
