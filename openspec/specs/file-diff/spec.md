## ADDED Requirements

### Requirement: Compare two files and generate diff

The system SHALL compare two files and generate a unified diff format output showing the differences.

#### Scenario: Identical files

- **WHEN** comparing two identical files
- **THEN** the system SHALL return an empty diff indicating no differences

#### Scenario: Files with added lines

- **WHEN** comparing files where the second file has additional lines
- **THEN** the diff SHALL show the added lines marked with `+`

#### Scenario: Files with removed lines

- **WHEN** comparing files where the second file has fewer lines
- **THEN** the diff SHALL show the removed lines marked with `-`

#### Scenario: Files with modified lines

- **WHEN** comparing files with both additions and deletions
- **THEN** the diff SHALL show all changes with appropriate `+` and `-` markers

### Requirement: Compare directories recursively

The system SHALL support comparing two directories recursively and generating a unified diff output.

#### Scenario: Compare identical directories

- **WHEN** comparing two identical directories
- **THEN** the system SHALL return an empty diff indicating no differences

#### Scenario: Compare directories with different files

- **WHEN** comparing directories where files exist in one but not the other
- **THEN** the diff SHALL show added files as new file content and removed files as deleted content

#### Scenario: Compare directories with modified files

- **WHEN** comparing directories with files of the same name but different content
- **THEN** the diff SHALL show the content differences for each modified file

#### Scenario: Recursive directory comparison

- **WHEN** comparing directories with `recursive: true` (default)
- **THEN** the system SHALL recursively compare all subdirectories and their contents

#### Scenario: Non-recursive directory comparison

- **WHEN** comparing directories with `recursive: false`
- **THEN** the system SHALL only compare files in the top-level directories

#### Scenario: Exclude patterns in directory diff

- **WHEN** comparing directories with `exclude: ['node_modules', '*.log']`
- **THEN** the system SHALL skip files and directories matching the exclude patterns

#### Scenario: Directory not found

- **WHEN** comparing where one or both paths are not directories
- **THEN** the system SHALL return an error with code `PATH_NOT_DIRECTORY`

### Requirement: Compare strings and generate diff

The system SHALL support comparing two strings and generating a unified diff output.

#### Scenario: String comparison

- **WHEN** comparing two multi-line strings
- **THEN** the system SHALL return a unified diff showing the differences between the strings

#### Scenario: Empty string comparison

- **WHEN** comparing an empty string with a non-empty string
- **THEN** the diff SHALL show all lines as additions or deletions

### Requirement: Diff output customization

The system SHALL support customizing the diff output format.

#### Scenario: Context lines configuration

- **WHEN** generating a diff with `contextLines: 5`
- **THEN** the output SHALL include exactly 5 context lines around each change

#### Scenario: Default context lines

- **WHEN** generating a diff without specifying context lines
- **THEN** the output SHALL include 3 context lines by default

#### Scenario: Unified diff format

- **WHEN** generating a diff
- **THEN** the output SHALL follow the unified diff format standard with proper headers and hunk markers

### Requirement: Diff statistics

The system SHALL provide statistics about the differences between files.

#### Scenario: Get diff statistics

- **WHEN** requesting diff statistics between two files
- **THEN** the system SHALL return the count of added lines, removed lines, and modified hunks

#### Scenario: Get directory diff statistics

- **WHEN** requesting diff statistics between two directories
- **THEN** the system SHALL return the count of files compared, added files, removed files, and modified files

#### Scenario: Statistics for identical files

- **WHEN** requesting statistics for identical files
- **THEN** all counts SHALL be zero

### Requirement: File size limit

The system SHALL support configurable file size limits for diff operations.

#### Scenario: Diff within size limit

- **WHEN** comparing files smaller than `maxFileSize` (default 1MB)
- **THEN** the diff SHALL be generated normally

#### Scenario: Diff exceeds size limit

- **WHEN** comparing files larger than `maxFileSize`
- **THEN** the system SHALL return an error with code `FILE_TOO_LARGE`

#### Scenario: Disable size limit

- **WHEN** comparing with `maxFileSize: null`
- **THEN** the system SHALL process files of any size using chunked processing

### Requirement: Chunked processing for large files

The system SHALL use chunked processing to handle large files efficiently.

#### Scenario: Process large file in chunks

- **WHEN** processing a file larger than the chunk size
- **THEN** the system SHALL process the file in chunks to avoid memory overflow

#### Scenario: Chunked diff accuracy

- **WHEN** generating a diff using chunked processing
- **THEN** the resulting diff SHALL be identical to non-chunked processing

### Requirement: File encoding handling

The system SHALL handle different file encodings during diff.

#### Scenario: Diff UTF-8 files

- **WHEN** comparing files with UTF-8 encoding
- **THEN** the system SHALL correctly handle multi-byte characters

#### Scenario: Diff with specified encoding

- **WHEN** comparing with `encoding: 'gbk'` (or other encoding)
- **THEN** the system SHALL use the specified encoding for reading files

#### Scenario: Encoding mismatch

- **WHEN** comparing files with different encodings
- **THEN** the system SHALL handle each file with its specified encoding

### Requirement: Empty file handling

The system SHALL handle diff operations involving empty files.

#### Scenario: Diff with empty file

- **WHEN** comparing a file with an empty file
- **THEN** the diff SHALL show all lines as additions or deletions

#### Scenario: Diff two empty files

- **WHEN** comparing two empty files
- **THEN** the system SHALL return an empty diff

### Requirement: Non-existent file handling

The system SHALL handle diff operations when files do not exist.

#### Scenario: First file not found

- **WHEN** comparing where the first file does not exist
- **THEN** the system SHALL return an error with code `FILE_NOT_FOUND`

#### Scenario: Second file not found

- **WHEN** comparing where the second file does not exist
- **THEN** the system SHALL return an error with code `FILE_NOT_FOUND`

### Requirement: Binary file detection

The system SHALL detect binary files and handle them appropriately.

#### Scenario: Binary file detected

- **WHEN** comparing files that contain binary content
- **THEN** the system SHALL return an error with code `VALIDATION_ERROR` indicating binary files are not supported

### Requirement: Line ending handling

The system SHALL handle different line endings consistently.

#### Scenario: Diff CRLF vs LF

- **WHEN** comparing a file with CRLF endings to a file with LF endings
- **THEN** the diff SHALL show the line ending differences

#### Scenario: Ignore line ending differences

- **WHEN** comparing with `ignoreLineEndings: true`
- **THEN** the system SHALL treat CRLF and LF as equivalent

### Requirement: Soft link handling

The system SHALL define consistent behavior for symbolic links in diff operations.

#### Scenario: Diff through symlinks

- **WHEN** comparing files where one or both are symbolic links
- **THEN** by default, the system SHALL follow the links and diff the target files

#### Scenario: Diff symlink targets

- **WHEN** comparing with `followSymlink: false`
- **THEN** the system SHALL return an error as symlinks cannot be diffed directly

### Requirement: Return structured results

The system SHALL return detailed results for all operations.

#### Scenario: Successful diff result

- **WHEN** a diff operation succeeds
- **THEN** the result SHALL include `success: true`, `diff` string, `addedLines`, `removedLines`, `hunks`, and `executionTime`

#### Scenario: Successful directory diff result

- **WHEN** a directory diff operation succeeds
- **THEN** the result SHALL include `success: true`, `diff` string, `filesCompared`, `filesAdded`, `filesRemoved`, `filesModified`, and `executionTime`

#### Scenario: Failed diff result

- **WHEN** a diff operation fails
- **THEN** the result SHALL include `success: false` and structured `error` with `code`, `message`, and optional `details`
