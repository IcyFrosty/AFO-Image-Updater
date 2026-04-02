Place your tray icon files here:

  tray-icon.png   — 32x32 px PNG (displayed at 16pt @2x on macOS Retina).
                    Use a black-on-transparent image; macOS will tint it
                    automatically for light/dark menu bars.
                    Set as a "template image" (see main.js).

  icon.icns       — macOS app icon (required for electron-builder --mac).
                    Generate from a 1024x1024 PNG using:
                      iconutil -c icns <your-icon.iconset>
                    Or use an online .icns generator.

  icon.ico        — Windows app icon (required for electron-builder --win).
                    Should contain 16, 32, 48, 256 px sizes.
