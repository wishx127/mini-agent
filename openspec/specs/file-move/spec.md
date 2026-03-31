# Spec: File Move Tool

## Purpose

文件移动/重命名工具，用于将文件从一个位置移动到另一个位置。支持跨目录移动和重命名，支持覆盖控制。

## Requirements

### Requirement: Move file to new location

The system SHALL move a file from source path to target path.

#### Scenario: Move file to existing directory

- **WHEN** the tool is invoked with a source file path and target directory
- **THEN** the system SHALL move the file to the target directory, keeping the same filename

#### Scenario: Move and rename file

- **WHEN** the tool is invoked with a source file path and target file path with different name
- **THEN** the system SHALL move the file to the target location with the new name

#### Scenario: Rename file in same directory

- **WHEN** the tool is invoked with source and target paths in the same directory but different filenames
- **THEN** the system SHALL rename the file

#### Scenario: Create parent directories

- **WHEN** the tool is invoked with a target path containing non-existent parent directories
- **THEN** the system SHALL automatically create all parent directories and then move the file

### Requirement: Handle existing target file

The system SHALL handle cases where the target file already exists.

#### Scenario: Target exists without overwrite

- **WHEN** the tool is invoked and the target file exists, and `overwrite: false` (default)
- **THEN** the system SHALL return an error with code FILE_ALREADY_EXISTS

#### Scenario: Target exists with overwrite

- **WHEN** the tool is invoked and the target file exists, and `overwrite: true`
- **THEN** the system SHALL overwrite the target file with the source file

### Requirement: Path security validation

The system SHALL validate that both source and target paths are within the project directory.

#### Scenario: Source outside project

- **WHEN** the tool is invoked with a source path outside the project directory
- **THEN** the system SHALL return an error with code PATH_ACCESS_DENIED

#### Scenario: Target outside project

- **WHEN** the tool is invoked with a target path outside the project directory
- **THEN** the system SHALL return an error with code PATH_ACCESS_DENIED

#### Scenario: Path traversal attempt

- **WHEN** the tool is invoked with a path containing traversal sequences (../)
- **THEN** the system SHALL resolve the path and validate it is within the project directory

### Requirement: Validate source exists and is file

The system SHALL validate that the source path exists and is a file.

#### Scenario: Source does not exist

- **WHEN** the tool is invoked with a source path that does not exist
- **THEN** the system SHALL return an error with code SOURCE_NOT_FOUND

#### Scenario: Source is directory

- **WHEN** the tool is invoked with a source path that is a directory
- **THEN** the system SHALL return an error with code IS_DIRECTORY

## Interface

### Tool Name

`move`

### Parameters

| Parameter   | Type    | Required | Description                                 |
| ----------- | ------- | -------- | ------------------------------------------- |
| source_path | string  | Yes      | Path to the source file to move             |
| target_path | string  | Yes      | Target path (directory or full file path)   |
| overwrite   | boolean | No       | Overwrite if target exists (default: false) |

### Returns

String indicating success with source and target paths, or error message.

### Console Output

```
📦 move: <source_path> → <target_path>
```

### Error Codes

- `SOURCE_NOT_FOUND`: Source file does not exist
- `PATH_ACCESS_DENIED`: Source or target is outside project directory
- `IS_DIRECTORY`: Source path is a directory (not a file)
- `FILE_ALREADY_EXISTS`: Target file exists and overwrite is false
- `MOVE_ERROR`: Failed to move file
