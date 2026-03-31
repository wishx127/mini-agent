# Spec: File Write Tool

## Purpose

文件写入工具，用于写入内容到文件。支持创建新文件或覆盖现有文件，自动创建父目录。

## Requirements

### Requirement: Write content to file

The system SHALL write specified content to a file.

#### Scenario: Create new file with content

- **WHEN** the tool is invoked with a file path and content, and the file does not exist
- **THEN** the system SHALL create the file with the specified content

#### Scenario: Overwrite existing file with overwrite true

- **WHEN** the tool is invoked with a file path and content, and the file exists, and `overwrite: true` (default)
- **THEN** the system SHALL overwrite the existing file with the new content

#### Scenario: Prevent overwrite with overwrite false

- **WHEN** the tool is invoked with a file path and content, and the file exists, and `overwrite: false`
- **THEN** the system SHALL return an error with code FILE_ALREADY_EXISTS

#### Scenario: Create file with nested directories

- **WHEN** the tool is invoked with a file path containing non-existent parent directories
- **THEN** the system SHALL automatically create all parent directories and then write the file

### Requirement: Path security validation

The system SHALL validate that the target path is within the project directory.

#### Scenario: Path outside project

- **WHEN** the tool is invoked with a path outside the project directory
- **THEN** the system SHALL return an error with code PATH_ACCESS_DENIED

#### Scenario: Path traversal attempt

- **WHEN** the tool is invoked with a path containing traversal sequences (../)
- **THEN** the system SHALL resolve the path and validate it is within the project directory

### Requirement: Content encoding

The system SHALL write content using UTF-8 encoding.

#### Scenario: Write Unicode content

- **WHEN** the tool is invoked with content containing Unicode characters
- **THEN** the system SHALL correctly write the file with UTF-8 encoding

## Interface

### Tool Name

`write`

### Parameters

| Parameter | Type    | Required | Description                              |
| --------- | ------- | -------- | ---------------------------------------- |
| path      | string  | Yes      | Path to the file to write                |
| content   | string  | Yes      | Content to write to the file             |
| overwrite | boolean | No       | Overwrite if file exists (default: true) |

### Returns

String indicating success with file path and content length, or error message.

### Console Output

```
📝 write: <path> (<length> bytes)
```

### Error Codes

- `PATH_ACCESS_DENIED`: Path is outside project directory
- `FILE_ALREADY_EXISTS`: File exists and overwrite is false
- `WRITE_ERROR`: Failed to write file
