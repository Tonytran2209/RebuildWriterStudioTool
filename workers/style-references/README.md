# Approved reference images

Add one owned or licensed PNG, JPEG or WebP per style with `node workers/add-style-reference.mjs STYLE_ID /absolute/path/to/image`.
The tool copies the file here, calculates its SHA-256 and increments the style version in `shared/imageStyles.json`.
Review the rights, subjects and content before committing. The worker checks the hash before sending the image to local ComfyUI.
