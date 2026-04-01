## ADDED Requirements

### Requirement: Search and replace text in file

The system SHALL support searching for text patterns in a file and replacing them with new content.

#### Scenario: Single occurrence replacement

- **WHEN** searching for a text pattern that occurs once in a file
- **THEN** the system SHALL replace that single occurrence with the new content

#### Scenario: Multiple occurrences replacement

- **WHEN** searching for a text pattern that occurs multiple times in a file with `replaceAll: true`
- **THEN** the system SHALL replace all occurrences with the new content

#### Scenario: First occurrence only replacement (default)

- **WHEN** searching for a text pattern with `replaceAll: false` (default)
- **THEN** the system SHALL replace only the first matching occurrence

#### Scenario: Replacement with no match

- **WHEN** searching for a text pattern that does not exist in the file
- **THEN** the system SHALL return an error with code `VALIDATION_ERROR` indicating no match was found

### Requirement: Flexible match options

The system SHALL support flexible matching options for search operations.

#### Scenario: Ignore whitespace matching

- **WHEN** searching with `matchOptions.ignoreWhitespace: true`
- **THEN** the system SHALL ignore whitespace differences (spaces, tabs, newlines) when matching

#### Scenario: Case insensitive matching

- **WHEN** searching with `matchOptions.caseInsensitive: true`
- **THEN** the system SHALL perform case-insensitive matching

#### Scenario: Whole word matching

- **WHEN** searching with `matchOptions.wholeWord: true`
- **THEN** the system SHALL only match whole words, not partial matches

#### Scenario: Combined match options

- **WHEN** searching with multiple match options enabled
- **THEN** the system SHALL apply all options together

### Requirement: Line-based file editing

The system SHALL support editing specific lines in a file by line number or line range.

#### Scenario: Insert lines at specific position

- **WHEN** inserting new lines at a specific line number
- **THEN** the new lines SHALL be inserted before the specified line, and subsequent lines SHALL be shifted down

#### Scenario: Delete line range

- **WHEN** deleting a range of lines by start and end line numbers
- **THEN** all lines in the specified range SHALL be removed from the file

#### Scenario: Replace line range

- **WHEN** replacing a range of lines with new content
- **THEN** the specified lines SHALL be replaced with the new content

### Requirement: Edit operation validation

The system SHALL validate edit operations before applying them.

#### Scenario: Invalid line number

- **WHEN** specifying a line number that exceeds the file's total lines
- **THEN** the system SHALL return an error with code `VALIDATION_ERROR` indicating the line number is out of range

#### Scenario: Empty search pattern

- **WHEN** providing an empty search pattern
- **THEN** the system SHALL return an error with code `VALIDATION_ERROR` indicating the search pattern cannot be empty

#### Scenario: Invalid line range

- **WHEN** specifying a line range where start > end
- **THEN** the system SHALL return an error with code `VALIDATION_ERROR`

### Requirement: User authorization for file edits

The system SHALL require user authorization before performing any file modification operations.

#### Scenario: Edit with user authorization

- **WHEN** calling `editFile()` with `requireAuth: true` (default)
- **AND** the user grants authorization via `authManager.askForAuth()`
- **THEN** the system SHALL execute the file modification
- **AND** atomically write the changes to the file
- **AND** generate a diff of the changes
- **AND** return `success: true`, `authorized: true`, and the `diff`

#### Scenario: Edit without authorization - operation rejected

- **WHEN** calling `editFile()` with `requireAuth: true` (default)
- **AND** the user denies authorization
- **THEN** the system SHALL NOT modify the file
- **AND** return an error with code `UNAUTHORIZED_OPERATION`

#### Scenario: Edit with authorization disabled

- **WHEN** calling `editFile()` with `requireAuth: false`
- **THEN** the system SHALL skip the authorization check
- **AND** execute the file modification directly
- **AND** generate a diff of the changes
- **AND** return `success: true` and the `diff`

#### Scenario: Authorization already granted

- **WHEN** calling `editFile()` and the user has already granted authorization for this operation
- **THEN** the system SHALL NOT ask for authorization again
- **AND** execute the file modification directly
- **AND** generate a diff of the changes
- **AND** return `success: true` and the `diff`

### Requirement: Atomic write operation

The system SHALL guarantee atomicity of edit operations using temp file and atomic rename.

#### Scenario: Successful atomic edit

- **WHEN** an edit operation succeeds with authorization
- **THEN** the system SHALL write content to a temp file first
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

The system SHALL support optimistic locking for edit operations.

#### Scenario: Edit with expected hash

- **WHEN** editing with `expectedHash` parameter
- **THEN** the system SHALL verify the file content SHA-256 hash matches before editing

#### Scenario: Concurrent modification detected

- **WHEN** editing with `expectedHash` but the file has been modified
- **THEN** the system SHALL return an error with code `CONCURRENT_MODIFICATION`

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

The system SHALL handle edit operations on empty files.

#### Scenario: Edit empty file

- **WHEN** searching for text in an empty file
- **THEN** the system SHALL return an error with code `VALIDATION_ERROR` indicating no match found

#### Scenario: Insert into empty file

- **WHEN** inserting lines into an empty file at line 1
- **THEN** the system SHALL create the file with the inserted content

### Requirement: File encoding handling

The system SHALL handle different file encodings.

#### Scenario: Edit with UTF-8 encoding

- **WHEN** editing a file with default encoding (UTF-8)
- **THEN** the system SHALL correctly read and write UTF-8 content

#### Scenario: Edit with specified encoding

- **WHEN** editing with `encoding: 'gbk'` (or other encoding)
- **THEN** the system SHALL use the specified encoding for read/write operations

#### Scenario: Encoding detection

- **WHEN** editing with `encoding: 'auto'`
- **THEN** the system SHALL attempt to detect the file encoding automatically
- **AND** return an error with code `ENCODING_ERROR` if detection fails

### Requirement: Line ending handling

The system SHALL preserve the original line ending style.

#### Scenario: Preserve CRLF line endings

- **WHEN** editing a file with CRLF line endings
- **THEN** the modified file SHALL retain CRLF line endings

#### Scenario: Preserve LF line endings

- **WHEN** editing a file with LF line endings
- **THEN** the modified file SHALL retain LF line endings

### Requirement: File permission handling

The system SHALL handle permission errors gracefully.

#### Scenario: Read-only file

- **WHEN** attempting to edit a read-only file
- **THEN** the system SHALL return an error with code `PERMISSION_DENIED`

#### Scenario: No write permission on directory

- **WHEN** attempting to create a file in a directory without write permission
- **THEN** the system SHALL return an error with code `PERMISSION_DENIED`

### Requirement: Return structured results

The system SHALL return detailed results for all operations.

#### Scenario: Successful edit result

- **WHEN** an edit operation succeeds
- **THEN** the result SHALL include `success: true`, `changes` count, `affectedRanges`, `diff` showing the actual changes, and `executionTime`

#### Scenario: Failed edit result - unauthorized

- **WHEN** an edit operation is rejected due to lack of user authorization
- **THEN** the result SHALL include `success: false` and error code `UNAUTHORIZED_OPERATION`

#### Scenario: Failed edit result - other errors

- **WHEN** an edit operation fails due to other reasons (validation, IO, etc.)
- **THEN** the result SHALL include `success: false` and structured `error` with `code`, `message`, and optional `details`
