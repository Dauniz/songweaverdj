# Rename the product to Songweaver

## What will change
- Rename the website and product to **Songweaver** across the home page, sign-in, Studio header, browser titles, and social metadata.
- Keep **Crate** as the AI companion’s name wherever the assistant speaks, recommends music, controls the radio path, or is described as knowing the user’s library.
- Keep existing users’ Walrus Memory namespace and internal code paths unchanged, preventing any loss of saved taste history or broken imports.
- Keep the existing logo artwork and all music, Spotify, chat, and memory behavior unchanged.

## Technical details
- Update product-facing labels, image descriptions, browser titles, social metadata, and relevant internal documentation to Songweaver.
- Keep Crate-specific chat identifiers, assistant prompts, radio wording, and internal guest identity conventions unchanged because they belong to the AI assistant.
- Preserve the existing `crate-<user>` Walrus namespace as a compatibility identifier so all previously saved memories remain available.
- Verify the home, sign-in, and Studio views so Songweaver is the product name and Crate appears only as the AI companion.
