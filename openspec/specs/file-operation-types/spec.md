# Spec: File Operation Types

## Purpose

定义文件操作相关的类型和错误码，为所有文件操作工具提供统一的类型支持。

## Requirements

### Requirement: File operation error codes

The system SHALL provide comprehensive error codes for all file operations.

#### Scenario: Write operation errors

- **WHEN** a write operation fails
- **THEN** the system SHALL return an appropriate error code from the extended set

#### Scenario: Delete operation errors

- **WHEN** a delete operation fails
- **THEN** the system SHALL return an appropriate error code from the extended set

#### Scenario: Move operation errors

- **WHEN** a move operation fails
- **THEN** the system SHALL return an appropriate error code from the extended set

### Requirement: Extended error codes for write operations

The system SHALL define additional error codes to support write operations.

#### Scenario: Write error

- **WHEN** a file write operation fails due to I/O error
- **THEN** the system SHALL use error code WRITE_ERROR

#### Scenario: File already exists

- **WHEN** attempting to create or move a file that already exists at the target
- **THEN** the system SHALL use error code FILE_ALREADY_EXISTS

#### Scenario: Path is directory

- **WHEN** attempting to perform a file operation on a directory path
- **THEN** the system SHALL use error code IS_DIRECTORY

#### Scenario: Delete error

- **WHEN** a file deletion operation fails
- **THEN** the system SHALL use error code DELETE_ERROR

### Requirement: Extended error codes for move operations

The system SHALL define additional error codes to support move operations.

#### Scenario: Move error

- **WHEN** a file move operation fails
- **THEN** the system SHALL use error code MOVE_ERROR

#### Scenario: Source not found

- **WHEN** attempting to move a file that does not exist
- **THEN** the system SHALL use error code SOURCE_NOT_FOUND

#### Scenario: User cancelled operation

- **WHEN** a user denies a confirmation request (e.g., delete confirmation)
- **THEN** the system SHALL use error code USER_CANCELLED

## Error Code Definitions

### Existing Error Codes

- `PATH_NOT_FOUND`: Path does not exist
- `PATH_ACCESS_DENIED`: Path is outside project directory
- `FILE_TOO_LARGE`: File exceeds size limit
- `INVALID_ENCODING`: File encoding is not supported
- `INVALID_REGEX`: Regular expression pattern is invalid
- `INVALID_GLOB_PATTERN`: Glob pattern is invalid

### New Error Codes

- `WRITE_ERROR`: Failed to write file
- `FILE_ALREADY_EXISTS`: File already exists at target path
- `IS_DIRECTORY`: Path is a directory, not a file
- `DELETE_ERROR`: Failed to delete file
- `MOVE_ERROR`: Failed to move file
- `SOURCE_NOT_FOUND`: Source file does not exist (Move tool)
- `USER_CANCELLED`: User denied the operation confirmation

## Interface

### Type Definition

```typescript
export enum FileOperationErrorCode {
  // Existing codes
  PATH_NOT_FOUND = 'PATH_NOT_FOUND',
  PATH_ACCESS_DENIED = 'PATH_ACCESS_DENIED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_ENCODING = 'INVALID_ENCODING',
  INVALID_REGEX = 'INVALID_REGEX',
  INVALID_GLOB_PATTERN = 'INVALID_GLOB_PATTERN',

  // New codes
  WRITE_ERROR = 'WRITE_ERROR',
  FILE_ALREADY_EXISTS = 'FILE_ALREADY_EXISTS',
  IS_DIRECTORY = 'IS_DIRECTORY',
  DELETE_ERROR = 'DELETE_ERROR',
  MOVE_ERROR = 'MOVE_ERROR',
  SOURCE_NOT_FOUND = 'SOURCE_NOT_FOUND',
  USER_CANCELLED = 'USER_CANCELLED',
}
```
