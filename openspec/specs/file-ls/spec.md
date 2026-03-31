# Spec: File LS Tool

## Purpose

目录遍历工具，用于列出指定目录中的文件和子目录，支持递归遍历和排序。

## Requirements

### Requirement: List directory contents

The system SHALL provide a tool to list files and directories within a specified path.

#### Scenario: List all contents

- **WHEN** the tool is invoked with a valid directory path
- **THEN** the system SHALL return a list of all files and subdirectories in that directory

#### Scenario: Handle non-existent directory

- **WHEN** the tool is invoked with a path that does not exist
- **THEN** the system SHALL return an error with code PATH_NOT_FOUND

#### Scenario: Path outside project

- **WHEN** the tool is invoked with a path outside the project directory
- **THEN** the system SHALL return an error with code PATH_ACCESS_DENIED

### Requirement: Filter by entry type

The system SHALL support filtering entries by type (files only, directories only, or both).

#### Scenario: List files only

- **WHEN** the tool is invoked with `type: 'files'` parameter
- **THEN** the system SHALL return only file entries, excluding directories

#### Scenario: List directories only

- **WHEN** the tool is invoked with `type: 'dirs'` parameter
- **THEN** the system SHALL return only directory entries, excluding files

#### Scenario: List all (default)

- **WHEN** the tool is invoked without type filter
- **THEN** the system SHALL return both files and directories

### Requirement: Show hidden files option

The system SHALL support showing or hiding hidden files (entries starting with dot).

#### Scenario: Show hidden files

- **WHEN** the tool is invoked with `show_hidden: true`
- **THEN** the system SHALL include hidden files in the results

#### Scenario: Hide hidden files (default)

- **WHEN** the tool is invoked without `show_hidden` parameter
- **THEN** the system SHALL exclude hidden files from the results

### Requirement: Recursive directory listing

The system SHALL support recursive traversal of subdirectories.

#### Scenario: Recursive listing

- **WHEN** the tool is invoked with `recursive: true`
- **THEN** the system SHALL return all files and directories in the specified path and all subdirectories

#### Scenario: Non-recursive listing (default)

- **WHEN** the tool is invoked without `recursive` parameter
- **THEN** the system SHALL return only direct children of the specified directory

### Requirement: Limit recursion depth

The system SHALL support limiting the recursion depth.

#### Scenario: Limit depth

- **WHEN** the tool is invoked with `recursive: true` and `max_depth: 2`
- **THEN** the system SHALL traverse only up to 2 levels deep from the specified path

#### Scenario: Unlimited depth

- **WHEN** the tool is invoked with `recursive: true` without `max_depth`
- **THEN** the system SHALL traverse all subdirectories without depth limit

### Requirement: Sort results

The system SHALL support sorting entries by name or modification time.

#### Scenario: Sort by name

- **WHEN** the tool is invoked with `sort_by: 'name'`
- **THEN** the system SHALL return entries sorted alphabetically by name

#### Scenario: Sort by time

- **WHEN** the tool is invoked with `sort_by: 'time'`
- **THEN** the system SHALL return entries sorted by modification time (newest first)

#### Scenario: No sorting (default)

- **WHEN** the tool is invoked without `sort_by` parameter
- **THEN** the system SHALL return entries in default filesystem order

## Interface

### Tool Name

`ls`

### Parameters

| Parameter   | Type                       | Required | Description                                                   |
| ----------- | -------------------------- | -------- | ------------------------------------------------------------- |
| path        | string                     | No       | Directory path to list (default: current directory)           |
| type        | 'files' \| 'dirs' \| 'all' | No       | Filter by entry type (default: 'all')                         |
| show_hidden | boolean                    | No       | Include hidden files (default: false)                         |
| recursive   | boolean                    | No       | Recursively list subdirectories (default: false)              |
| max_depth   | number                     | No       | Maximum recursion depth (only applies when recursive is true) |
| sort_by     | 'name' \| 'time'           | No       | Sort entries by name or modification time                     |

### Returns

String containing formatted directory listing with entry names and type indicators (📁 for directories, 📄 for files). For recursive listings, entries are indented to show hierarchy.

### Console Output

```
📂 ls: <path>
```
