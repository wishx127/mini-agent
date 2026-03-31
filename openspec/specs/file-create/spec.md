# Spec: File Create Tool

## Purpose

文件创建工具，用于创建新文件，支持自动创建父目录。默认情况下如果文件已存在则返回错误，可通过 overwrite 参数强制覆盖。

## Requirements

### Requirement: Create new file

The system SHALL create a new file at the specified path.

#### Scenario: Create file in existing directory

- **WHEN** the tool is invoked with a file path in an existing directory
- **THEN** the system SHALL create an empty file at the specified path

#### Scenario: Create file with nested directories

- **WHEN** the tool is invoked with a file path containing non-existent parent directories
- **THEN** the system SHALL automatically create all parent directories and then create the file

#### Scenario: File already exists without overwrite

- **WHEN** the tool is invoked with a path to an existing file and `overwrite: false` (default)
- **THEN** the system SHALL return an error with code FILE_ALREADY_EXISTS

#### Scenario: File already exists with overwrite

- **WHEN** the tool is invoked with a path to an existing file and `overwrite: true`
- **THEN** the system SHALL overwrite the existing file

### Requirement: Path security validation

The system SHALL validate that the target path is within the project directory.

#### Scenario: Path outside project

- **WHEN** the tool is invoked with a path outside the project directory
- **THEN** the system SHALL return an error with code PATH_ACCESS_DENIED

#### Scenario: Path traversal attempt

- **WHEN** the tool is invoked with a path containing traversal sequences (../)
- **THEN** the system SHALL resolve the path and validate it is within the project directory

### Requirement: Prevent directory creation confusion

The system SHALL NOT create a directory when a file path is specified.

#### Scenario: Path ends with slash

- **WHEN** the tool is invoked with a path ending with slash (indicating directory)
- **THEN** the system SHALL return an error indicating the path appears to be a directory

## Interface

### Tool Name

`create`

### Parameters

| Parameter | Type    | Required | Description                               |
| --------- | ------- | -------- | ----------------------------------------- |
| path      | string  | Yes      | Path to the file to create                |
| overwrite | boolean | No       | Overwrite if file exists (default: false) |

### Returns

String indicating success with file path, or error message.

### Console Output

```
📄 create: <path>
```

### Error Codes

- `PATH_ACCESS_DENIED`: Path is outside project directory
- `FILE_ALREADY_EXISTS`: File exists and overwrite is false
- `IS_DIRECTORY`: Path appears to be a directory (ends with slash)
- `WRITE_ERROR`: Failed to create file
