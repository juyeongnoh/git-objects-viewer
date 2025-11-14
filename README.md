# Git Objects Viewer

View Git object files in plain text by automatically decompressing them with zlib.

No additional requirements. Works with any Git repository.

![git-objects-viewer](https://github.com/user-attachments/assets/2eab2d44-81d5-478b-8b35-e01323ddb62a)

## Features

- **View Git Objects in Explorer**: Browse `.git/objects` directory in a tree view
- **Automatic Decompression**: Automatically decompress Git object files using zlib
- **Context Menu Integration**: Right-click on Git object files to open them as text
- **Object Information**: Display object type, size, and hash

## Before Starting

Make sure to unhide `.git` directory first.

1. Go to Preferences -> Settings
2. Search keyword `exclude`
3. Delete `**/.git` on the list.

## Usage

1. Open a Git repository in VS Code
2. Right-click on any objects in `.git/objects` and select "Open as Git Object"
