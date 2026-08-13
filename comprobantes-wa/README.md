# WhatsApp Group Media Downloader Bot

A premium, reliable, and asynchronous WhatsApp bot developed using **WhiskeySockets/Baileys** and **pnpm** that automatically monitors a specific WhatsApp group chat and downloads all sent media files (images, videos, audio messages, documents, stickers) into a dedicated local directory.

---

## Features

- **Robust Media Detection:** Recursively unrolls wrapped message payloads (including Ephemeral and View Once structures) while ignoring quoted reply context to avoid duplicate downloads.
- **Chronological & Collision-Free Naming:** Files are saved using a sortable, unique timestamp-based format: `YYYYMMDD_HHmmss_${senderNumber}_${messageId}_${sanitizedFilename}.${extension}`.
- **Smart Group Target Filtering:** Allows targeting groups using either direct Group JIDs (recommended) or Group Subject names (case-insensitive filter).
- **Group discovery list:** On startup, the bot queries and logs all groups you are enrolled in along with their JIDs, allowing you to easily locate and copy JIDs.
- **Auto Reconnect:** Auto-reconnect logic handles network interruptions, only termination or voluntary sign-out ends the session.

---

## Quick Start Guide

### 1. Requirements

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (v9+)

### 2. Installation

Install all project dependencies using pnpm:

```bash
pnpm install
```

### 3. Configuration

Duplicate the configuration template to create your `.env` configuration file:

```bash
copy .env.example .env
```

Open `.env` and fill out your monitoring parameters:

```env
# Specific group details to monitor.
# - If you know the group's WhatsApp ID (JID), paste it here (e.g., 120363228941654321@g.us).
# - If you don't know the JID, leave TARGET_GROUP_JID empty and write the exact group name in TARGET_GROUP_SUBJECT.
# - If both are empty, the bot will start, list all groups you participate in with their JIDs, and wait.
TARGET_GROUP_JID=""
TARGET_GROUP_SUBJECT="Invoice Group"

# Folder where downloaded media files will be saved
MEDIA_DIR="./media"

# Logging level: 'trace', 'debug', 'info', 'warn', 'error', 'fatal'
LOG_LEVEL="info"
```

### 4. Running the Bot

Run the start command:

```bash
pnpm start
```

1. Upon starting, the terminal will render a **QR code**.
2. Open WhatsApp on your phone, go to **Settings > Linked Devices**, tap **Link a Device**, and scan the QR code.
3. The session credentials will save inside the local `auth_info/` directory so you won't need to log in again on subsequent runs.
4. The bot will print a list of all your WhatsApp Groups and their corresponding **JIDs**. You can copy-paste any JID into the `.env` file's `TARGET_GROUP_JID` parameter for a precise filter!
5. Any media files posted to your targeted group will be saved in the `./media` directory.

---

## File Naming Convention

Downloaded media files are automatically sanitized and named using the following format:
```
[YYYYMMDD_HHmmss]_[sender_number]_[unique_message_id]_[filename_or_type_fallback].[derived_extension]
```
- **Example image:** `20260718_224530_5491155432123_3A8BE92348A_image.jpeg`
- **Example document:** `20260718_224615_12015550239_3F82A45C33_invoice_july.pdf`

---

## Document OCR & Information Processing

We also provide a Python utility script, `proccess.py`, that connects to **OpenRouter** to run OCR and extract structured invoice details from your downloaded media files using a multimodal vision LLM (like Gemini 2.5 Flash, Llama 3.2 Vision, or Qwen VL).

### 1. Requirements
Ensure you have Python installed, as well as the HTTP client library:
```bash
python -m pip install requests python-dotenv
```

### 2. Configuration
The script targets your `MEDIA_DIR` folder from the `.env` file. You need an **OpenRouter API Key** (from [OpenRouter](https://openrouter.ai/)).

Add the configurations to your `.env` file:
```env
# OpenRouter Credentials
OPENROUTER_API_KEY="your_openrouter_api_key"

# Active Vision Model (defaults to google/gemini-2.5-flash)
OPENROUTER_MODEL="google/gemini-2.5-flash"
```
*(If you run the script without it set, the script will prompt you and offer to auto-save the key directly to your `.env` file).*

### 3. Running the script
Start the interactive terminal CLI tool:
```bash
python proccess.py
```
- Select which file you'd like to analyze (sorted from newest download to oldest).
- Press ``m`` to switch the active model (e.g. to a free model like `meta-llama/llama-3.2-11b-vision-instruct:free`).
- Choose whether you want a **structured invoice breakdown**, a **raw text OCR dump**, or whether you'd like to write a **custom prompt** (chatting with the document).






