# Security Specification (Phase 0)

## 1. Data Invariants
1. Every `FolderLookup` document under `/folderLookups/{lookupId}` belongs strictly to a single authenticated, email-verified user (`ownerId == request.auth.uid`), with `lookupId` matching `^[a-zA-Z0-9_\-]+$` (<= 128 chars).
2. Every `VideoPostRecord` document under `/folderLookups/{lookupId}/videoPosts/{videoId}` cannot exist without an existing parent `/folderLookups/{lookupId}` owned by the same verified user (verified via `get()` on create/update/delete).
3. `ownerId`, `lookupId`, `folderId`, `videoId`, and `createdAt` are immutable after creation; `createdAt` (on create) and `updatedAt` (on create and update) MUST equal `request.time`.
4. All strings and arrays have strict upper length/size bounds; `hasAll()` + `hasOnly()` prevent shadow fields on creation, and action-based `affectedKeys().hasOnly()` constrains updates.
5. `allow list` rules strictly evaluate `resource.data.ownerId == request.auth.uid` without calling `get()` or `exists()`.
6. Every `DeliveryLog` under `/deliveryLogs/{logId}` is owner-only (`ownerId == request.auth.uid`), verified on create, and immutable (`allow update: if false`).
7. Every `UserPreferences` document under `/userPreferences/{userId}` enforces `userId == request.auth.uid` and `ownerId == request.auth.uid`, with bounded preferences and `lastFolderId`/`lastFolderName`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Write**: Create `/folderLookups/f1` with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: Create `/folderLookups/f1` with `email_verified: false` -> `PERMISSION_DENIED`.
3. **Identity Spoofing on Create**: User A sets `ownerId: "user_b"` on `/folderLookups/f1` -> `PERMISSION_DENIED`.
4. **Shadow / Ghost Field on Create**: User A adds `isAdmin: true` to `/folderLookups/f1` -> `PERMISSION_DENIED`.
5. **Client-Spoofed Timestamp**: User A passes a client timestamp `createdAt` instead of `request.time` -> `PERMISSION_DENIED`.
6. **ID Poisoning**: User A writes `/folderLookups/bad$id/videoPosts/v1` or 200-char ID -> `PERMISSION_DENIED`.
7. **Orphaned Subcollection Write**: User A creates `/folderLookups/nonexistent/videoPosts/v1` -> `PERMISSION_DENIED`.
8. **Cross-Tenant Subcollection Hijack**: User B creates `/folderLookups/userA_folder/videoPosts/v1` even with `ownerId: "user_b"` -> `PERMISSION_DENIED` (Master Gate blocks).
9. **Immortal Field Mutation**: User A updates `ownerId`, `folderId`, or `createdAt` on `/folderLookups/f1` -> `PERMISSION_DENIED`.
10. **Value Poisoning / Oversized String**: User A updates `folderName` to a 5,000-char string or non-string -> `PERMISSION_DENIED`.
11. **Array Exhaustion**: User A puts 100 hashtags in `instagram.hashtags` (limit 35) -> `PERMISSION_DENIED`.
12. **Blanket List Scraping**: User B lists `/folderLookups` without `where('ownerId', '==', 'user_b')` -> `PERMISSION_DENIED`.
