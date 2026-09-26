# Rename Crate to Songweaver

## What will change
- Replace the visible Crate name with **Songweaver** across the home page, sign-in, Studio, dialogs, library text, and page metadata.
- Update the AI companion and radio-DJ identity so generated responses refer to Songweaver.
- Keep existing users’ Walrus Memory namespace and internal code paths unchanged, preventing any loss of saved taste history or broken imports.
- Keep the existing logo artwork and all music, Spotify, chat, and memory behavior unchanged.

## Technical details
- Update user-facing labels, image descriptions, browser titles, social metadata, and relevant internal documentation.
- Rename the active chat session identifier and new internal guest email domain where safe.
- Preserve the existing `crate-<user>` Walrus namespace as a compatibility identifier so all previously saved memories remain available.
- Verify the renamed home, sign-in, and Studio views and check that no old visible branding remains.
