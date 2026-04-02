## ADDED Requirements

### Requirement: Apply unified diff patch to file

The system SHALL support applying a unified diff format patch to a file, modifying only the specified lines while preserving the rest of the file content.

#### Scenario: Apply single hunk patch

- **WHEN** a unified diff patch with a single hunk is applied to a file
- **THEN** the file SHALL be modified according to the patch, removing lines marked with `-` and adding lines marked with `+`

#### Scenario: Apply multi-hunk patch

- **WHEN** a unified diff patch with multiple hunks is applied to a file
- **THEN** all hunks SHALL be applied in order, and the file SHALL reflect all modifications

#### Scenario: Patch with context lines

- **WHEN** a patch includes context lines (unchanged lines around modifications)
- **THEN** the system SHALL verify the context lines match the original file before applying the patch

#### Scenario: Patch application failure

- **WHEN** the patch context does not match the file content
- **THEN** the system SHALL reject the patch and return an error with code `PATCH_MISMATCH`

#### Scenario: Atomic patch application

- **WHEN** applying a multi-hunk patch where one hunk fails validation
- **THEN** no hunk SHALL be applied, and the file SHALL remain unchanged

### Requirement: Patch format validation

The system SHALL validate the patch format before attempting to apply it.

#### Scenario: Invalid patch format

- **WHEN** an invalid or malformed unified diff is provided
- **THEN** the system SHALL return an error with code `VALIDATION_ERROR` describing the format issue

#### Scenario: Missing target file

- **WHEN** attempting to apply a patch to a non-existent file
- **THEN** the system SHALL return an error with code `FILE_NOT_FOUND`

### Requirement: Dry run mode

The system SHALL support a dry run mode that validates the patch without modifying the file.

#### Scenario: Dry run successful

- **WHEN** applying a patch with `dryRun: true` (default)
- **THEN** the system SHALL validate all hunks and return success status without modifying the file
- **AND** the result SHALL include `hunks` and `hunksValid` counts

#### Scenario: Dry run failure

- **WHEN** applying an invalid patch with `dryRun: true`
- **THEN** the system SHALL return an error without modifying the file

#### Scenario: Actual application

- **WHEN** applying a patch with `dryRun: false`
- **THEN** the system SHALL validate and apply the patch to the file

### Requirement: User authorization for patch operations

The system SHALL require user authorization before performing any patch operations that modify files.

#### Scenario: Patch with user authorization

- **WHEN** calling `applyPatch()` with `requireAuth: true` (default)
- **AND** the user grants authorization via `authManager.askForAuth()`
- **THEN** the system SHALL execute the patch operation
- **AND** atomically write the patched content to the file
- **AND** generate a diff of the changes
- **AND** return `success: true`, `authorized: true`, and the `diff`

#### Scenario: Patch without authorization - operation rejected

- **WHEN** calling `applyPatch()` with `requireAuth: true` (default)
- **AND** the user denies authorization
- **THEN** the system SHALL NOT modify the file
- **AND** return an error with code `UNAUTHORIZED_OPERATION`

#### Scenario: Patch with authorization disabled

- **WHEN** calling `applyPatch()` with `requireAuth: false`
- **THEN** the system SHALL skip the authorization check
- **AND** execute the patch operation directly
- **AND** generate a diff of the changes
- **AND** return `success: true` and the `diff`

#### Scenario: Authorization already granted

- **WHEN** calling `applyPatch()` and the user has already granted authorization for this operation
- **THEN** the system SHALL NOT ask for authorization again
- **AND** execute the patch operation directly
- **AND** generate a diff of the changes
- **AND** return `success: true` and the `diff`

### Requirement: Atomic write operation

The system SHALL guarantee atomicity of patch operations using temp file and atomic rename.

#### Scenario: Successful atomic patch

- **WHEN** a patch operation succeeds
- **THEN** the system SHALL write the patched content to a temp file first
- **AND** atomically rename the temp file to replace the original file
- **AND** the file SHALL always be in a complete state (never partially written)

#### Scenario: Failed temp file write

- **WHEN** writing to temp file fails (disk full, permission denied, etc.)
- **THEN** the system SHALL return an error with code `WRITE_TEMP_FAILED`
- **AND** the original file SHALL remain unchanged

#### Scenario: Failed atomic rename

- **WHEN** atomic rename operation fails
- **THEN** the system SHALL delete the temp file
- **AND** return an error with code `RENAME_FAILED`
- **AND** the original file SHALL remain unchanged

### Requirement: Concurrent modification detection

The system SHALL support optimistic locking to prevent concurrent modifications.

#### Scenario: Patch with expected hash

- **WHEN** applying a patch with `expectedHash` parameter
- **THEN** the system SHALL verify the file content SHA-256 hash matches `expectedHash` before applying

#### Scenario: Concurrent modification detected

- **WHEN** applying a patch with `expectedHash` but the file has been modified
- **THEN** the system SHALL return an error with code `CONCURRENT_MODIFICATION`
- **AND** the file SHALL remain unchanged

### Requirement: Get file hash helper

The system SHALL provide a helper function to calculate file hash for optimistic locking.

#### Scenario: Get file hash

- **WHEN** calling `getFileHash(filePath)`
- **THEN** the system SHALL return the SHA-256 hash of the file content
- **AND** the result SHALL include `success: true` and `hash` value

#### Scenario: Get hash for non-existent file

- **WHEN** calling `getFileHash(filePath)` on a non-existent file
- **THEN** the system SHALL return an error with code `FILE_NOT_FOUND`

### Requirement: Empty file handling

The system SHALL handle patch operations on empty files.

#### Scenario: Patch empty file

- **WHEN** applying a patch to an empty file
- **THEN** the system SHALL apply the patch if the patch context allows (e.g., creating new file content)
- **AND** return an error with code `PATCH_MISMATCH` if the patch expects existing content

#### Scenario: Create file via patch

- **WHEN** applying a patch that adds content to a non-existent or empty file
- **THEN** the system SHALL create the file with the patch content

### Requirement: File permission handling

The system SHALL handle file permission errors gracefully.

#### Scenario: Read-only file

- **WHEN** attempting to apply a patch to a read-only file
- **THEN** the system SHALL return an error with code `PERMISSION_DENIED`

#### Scenario: No write permission on directory

- **WHEN** attempting to apply a patch in a directory without write permission
- **THEN** the system SHALL return an error with code `PERMISSION_DENIED`

### Requirement: Soft link handling

The system SHALL define consistent behavior for symbolic links.

#### Scenario: Patch through symlink

- **WHEN** applying a patch to a symbolic link
- **THEN** by default, the system SHALL follow the link and patch the target file

#### Scenario: Patch symlink itself

- **WHEN** applying a patch to a symbolic link with `followSymlink: false`
- **THEN** the system SHALL return an error as symlinks cannot be patched directly

### Requirement: Return structured results

The system SHALL return detailed results for all operations.

#### Scenario: Successful patch result

- **WHEN** a patch is successfully applied
- **THEN** the result SHALL include `success: true`, `changes` count, `hunks`, `hunksValid`, `diff` showing the actual changes, and `executionTime`

#### Scenario: Failed patch result - unauthorized

- **WHEN** a patch operation is rejected due to lack of user authorization
- **THEN** the result SHALL include `success: false` and error code `UNAUTHORIZED_OPERATION`

#### Scenario: Failed patch result - other errors

- **WHEN** a patch application fails due to other reasons (validation, IO, etc.)
- **THEN** the result SHALL include `success: false` and structured `error` with `code`, `message`, and optional `details`
