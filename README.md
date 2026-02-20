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
**Supported Distributions:** Ubuntu, Debian, Fedora, Arch Linux, Manjaro, Mint, and most others.

1.  Download the latest `.AppImage` file from the **[Releases](../../releases)** page.
2.  Right-click the file > **Properties** > **Permissions**.
3.  Check **"Allow executing file as program"** (or run `chmod +x filename.AppImage` in terminal).
4.  Double-click to run.

*> **Note for Ubuntu 22.04+ users:** If the app doesn't open, you may need to install FUSE support: `sudo apt install libfuse2`*

### Option B: DEB Installer (Debian/Ubuntu/Mint)
**Recommended for:** Ubuntu, Linux Mint, Pop!_OS, Debian.

1.  Download the latest `.deb` file from the **[Releases](../../releases)** page.
2.  Double-click to open in Software Center and click **Install**.
3.  **Or via terminal:**
    ```bash
    sudo dpkg -i LocalVideoPlayer-1.0.0.deb
    ```
4.  Launch "Local Video Player" from your applications menu.

### 🗑️ Uninstalling on Linux (Debian/Ubuntu)
To uninstall the `.deb` version:
```bash
sudo apt remove local-videoplayer
```

---

## 🐞 Troubleshooting

- **White Screen on Launch:** Wait a few seconds, the local server is starting up.
- **Videos Not Playing:** Ensure your video folder path is correct in the settings (Folder icon).
- **"Unrecognized Developer":** This is normal for self-built apps. Use the "Right-click > Open" trick on Mac/Windows if blocked.
