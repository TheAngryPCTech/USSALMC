=== USSALMC Wiki ===
Contributors: ussalmc
Requires PHP: 8.0
Stable tag: 0.1.0
License: MIT

Star Citizen wiki consumer for the USSA Lore Master Core.

Reads entities from the core REST API (/v1) using a server-side Bearer key and
renders them with the [ussalmc_entity id="..."] shortcode. The API key is stored
in wp_options (ussalmc_api_key) and is never sent to the browser.

This directory is bind-mounted into the WordPress container at
wp-content/plugins/ussalmc-wiki so edits on disk are live without a rebuild.
