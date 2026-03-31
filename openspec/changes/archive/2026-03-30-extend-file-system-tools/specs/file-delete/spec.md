# Spec: File Delete Tool

## Overview

文件删除工具，用于安全地删除文件。仅支持删除文件，不支持删除目录。执行前需要用户手动确认授权。

## ADDED Requirements

### Requirement: Delete single file with user confirmation

The system SHALL delete a specified file only after receiving user confirmation.

#### Scenario: Request deletion confirmation

- **WHEN** the tool is invoked with a path to an existing file
- **THEN** the system SHALL return a confirmation request to the user with file details
- **AND** the system SHALL NOT delete the file yet

#### Scenario: User confirms deletion

- **WHEN** the user confirms the deletion request
- **THEN** the system SHALL delete the file and return success

#### Scenario: User denies deletion

- **WHEN** the user denies the deletion request
- **THEN** the system SHALL cancel the operation and return cancellation status
- **AND** the file SHALL remain unchanged

#### Scenario: File does not exist

- **WHEN** the tool is invoked with a path to a non-existent file
- **THEN** the system SHALL return an error with code PATH_NOT_FOUND
- **AND** no confirmation request is needed

### Requirement: Path security validation

The system SHALL validate that the target file is within the project directory.

#### Scenario: File outside project

- **WHEN** the tool is invoked with a file path outside the project directory
- **THEN** the system SHALL return an error with code PATH_ACCESS_DENIED
- **AND** no confirmation request is needed

### Requirement: Directory deletion prevention

The system SHALL prevent deletion of directories.

#### Scenario: Attempt to delete directory

- **WHEN** the tool is invoked with a path to a directory
- **THEN** the system SHALL return an error with code IS_DIRECTORY
- **AND** no confirmation request is needed

## Interface

### Tool Name

`delete`

### Parameters

| Parameter | Type   | Required | Description                |
| --------- | ------ | -------- | -------------------------- |
| file_path | string | Yes      | Path to the file to delete |

### Returns

- **Confirmation Request**: When file exists and passes validation, returns confirmation request
- **Success**: After user confirms, returns success message with deleted file path
- **Cancelled**: If user denies, returns cancellation message
- **Error**: If file doesn't exist, is directory, or outside project, returns error

### Confirmation Request Format

```
🗑️ Delete Confirmation Required:
   File: <file_path>
   Size: <file_size>
   Modified: <last_modified_time>

   Do you want to permanently delete this file? (yes/no)
```

### Console Output (after confirmation)

```
🗑️ delete: <file_path>
```

### Error Codes

- `PATH_NOT_FOUND`: File does not exist
- `PATH_ACCESS_DENIED`: File is outside project directory
- `IS_DIRECTORY`: Path is a directory, not a file
- `DELETE_ERROR`: Failed to delete file
- `USER_CANCELLED`: User denied the deletion confirmation

### Safety Notes

- This tool only deletes files, not directories
- No recycle bin / trash functionality - deletion is permanent
- Path validation ensures files outside project cannot be deleted
- User confirmation is required before any deletion
