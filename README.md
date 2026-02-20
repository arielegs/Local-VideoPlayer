# Local Video Player

A lightweight, local, and private video player.

## About
This application allows you to play videos from your local machine with a clean, distraction-free interface.

---

# How to Run & Install `Local Video Player`

This guide explains how to build, install, and run the **Local Video Player** on Windows, macOS, and Linux.

---

## 🏗️ 1. Building the Application (For Developers)

To generate the installer files (exe, dmg, AppImage), run the following command in the terminal inside the project folder:

```bash
# Build for ALL platforms (might require mac/linux host for perfect results)
npm run build:all

# Build specific platform
npm run build:win   # Windows
npm run build:mac   # macOS
npm run build:linux # Linux
```

The output files will be located in the `dist` folder.

---

## 🖥️ 2. Running on Windows

### Option A: Installer (Recommended)
1.  Download the latest installer (`.exe`) from the **[Releases](../../releases)** page.
2.  Run the installer.
3.  Follow the installation steps.
4.  Launch "Local Video Player" from your Start Menu or Desktop.

### Option B: Portable
1.  Download the portable executable if available from the **[Releases](../../releases)** page.
2.  Double-click to run.

---

## 🍎 3. Running on macOS

### Option A: DMG Installer
1.  Download the latest `.dmg` file from the **[Releases](../../releases)** page.
2.  Open the file.
3.  Drag the app icon into your `Applications` folder.
4.  Run it from Launchpad or Spotlight.

**Note on Security:** Since this app is not signed with an Apple Developer ID (which costs \$99/year), macOS might block it initially. To fix this:
1.  Right-click the app > **Open**.
2.  Click **Open** in the warning dialog.

---

## 🐧 4. Running on Linux

### Option A: AppImage (Universal)
1.  Download the latest `.AppImage` file from the **[Releases](../../releases)** page.
2.  Right-click the file > **Properties** > **Permissions**.
3.  Check **"Allow executing file as program"** (or run `chmod +x filename.AppImage` in terminal).
4.  Double-click to run.

---

## 🐞 Troubleshooting

- **White Screen on Launch:** Wait a few seconds, the local server is starting up.
- **Videos Not Playing:** Ensure your video folder path is correct in the settings (Folder icon).
- **"Unrecognized Developer":** This is normal for self-built apps. Use the "Right-click > Open" trick on Mac/Windows if blocked.
