import os
import sys
import json
import base64
import mimetypes
from datetime import datetime
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ANSI Color Codes for Premium CLI Experience
CLEAR_SCREEN = "\033[H\033[2J"
STYLE_BOLD = "\033[1m"
COLOR_CYAN = "\033[96m"
COLOR_GREEN = "\033[92m"
COLOR_YELLOW = "\033[93m"
COLOR_RED = "\033[91m"
COLOR_MAGENTA = "\033[95m"
COLOR_GRAY = "\033[90m"
COLOR_RESET = "\033[0m"

# OpenRouter Chat Completions Endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

def print_banner():
    print(f"{COLOR_CYAN}{STYLE_BOLD}")
    print(" ┌────────────────────────────────────────────────────────┐")
    print(" │       ⚡ WHATSAPP INVOICE OCR & PROCESSOR (VL) ⚡       │")
    print(" └────────────────────────────────────────────────────────┘")
    print(f"{COLOR_RESET}")

def get_api_key():
    """Ensure OpenRouter API key exists, prompt user if missing."""
    api_key = os.getenv("OPENROUTER_API_KEY")
    if api_key:
        return api_key.strip()
            
    print(f"\n{COLOR_YELLOW}⚠️  Missing OPENROUTER_API_KEY in environment or .env file!{COLOR_RESET}")
    print("To get a key, visit: https://openrouter.ai/\n")
    
    key_input = input(f"{STYLE_BOLD}Please enter your OpenRouter API Key:{COLOR_RESET} ").strip()
    if not key_input:
        print(f"{COLOR_RED}❌ API Key is required to run analysis. Exiting.{COLOR_RESET}")
        sys.exit(1)
        
    save_choice = input(f"\nWould you like to save this key to your .env file? (y/n) [y]: ").strip().lower()
    if save_choice in ['', 'y', 'yes']:
        try:
            env_path = ".env"
            content = ""
            if os.path.exists(env_path):
                with open(env_path, "r", encoding="utf-8") as f:
                    content = f.read()
            
            content = content.rstrip()
            if "OPENROUTER_API_KEY" in content:
                lines = content.split('\n')
                for idx, line in enumerate(lines):
                    if line.startswith("OPENROUTER_API_KEY="):
                        lines[idx] = f"OPENROUTER_API_KEY=\"{key_input}\""
                        break
                content = '\n'.join(lines)
            else:
                delimiter = "\n" if content else ""
                content += f'{delimiter}# OpenRouter API Key\nOPENROUTER_API_KEY="{key_input}"\n'
                
            with open(env_path, "w", encoding="utf-8") as f:
                f.write(content + "\n")
                
            print(f"{COLOR_GREEN}✅ Successfully saved OPENROUTER_API_KEY to .env!{COLOR_RESET}")
        except Exception as e:
            print(f"{COLOR_RED}⚠️  Failed to save to .env: {e}{COLOR_RESET}")
            
    return key_input

def get_media_dir():
    """Resolves media directory from .env or defaults to './media'."""
    media_raw = os.getenv("MEDIA_DIR", "./media")
    current_dir = os.path.dirname(os.path.abspath(__file__))
    resolved_path = os.path.abspath(os.path.join(current_dir, media_raw))
    return resolved_path

def get_configured_model():
    """Gets model from .env or returns a default vision model."""
    model = os.getenv("OPENROUTER_MODEL", "google/gemini-2.5-flash")
    return model.strip()

def list_media_files(media_dir):
    """Retrieve list of processable files in chronological order (newest first)."""
    if not os.path.exists(media_dir):
        return []
    
    valid_exts = {'.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif', '.pdf'}
    
    files = []
    for item in os.listdir(media_dir):
        filepath = os.path.join(media_dir, item)
        if os.path.isfile(filepath):
            _, ext = os.path.splitext(item)
            if ext.lower() in valid_exts:
                stat = os.stat(filepath)
                timestamp = stat.st_mtime
                if len(item) >= 15:
                    date_try = item[:15]
                    try:
                        timestamp = datetime.strptime(date_try, "%Y%m%d_%H%M%S").timestamp()
                    except ValueError:
                        pass
                
                files.append({
                    "name": item,
                    "path": filepath,
                    "size_kb": round(stat.st_size / 1024, 1),
                    "mtime": stat.st_mtime,
                    "sort_key": timestamp
                })
                
    files.sort(key=lambda x: x["sort_key"], reverse=True)
    return files

def show_file_menu(files):
    """Draws a premium file selection menu."""
    print(f"\n{STYLE_BOLD}{COLOR_CYAN}Available Media Files (Newest First):{COLOR_RESET}")
    print(f"{COLOR_GRAY}┌───┬───────────────────────────────────────────┬────────────┬─────────────────────┐{COLOR_RESET}")
    print(f"{COLOR_GRAY}│{COLOR_RESET} {STYLE_BOLD}# {COLOR_GRAY}│{COLOR_RESET} {STYLE_BOLD}File Name{COLOR_GRAY}{' ' * 32}│{COLOR_RESET} {STYLE_BOLD}File Size{COLOR_GRAY} │{COLOR_RESET} {STYLE_BOLD}Date Downloaded{COLOR_GRAY}     │{COLOR_RESET}")
    print(f"{COLOR_GRAY}├───┼───────────────────────────────────────────┼────────────┼─────────────────────┤{COLOR_RESET}")
    
    for idx, f in enumerate(files, 1):
        name_display = f["name"]
        if len(name_display) > 41:
            name_display = name_display[:38] + "..."
        else:
            name_display = name_display.ljust(41)
            
        size_display = f"{f['size_kb']} KB".rjust(10)
        date_display = datetime.fromtimestamp(f["mtime"]).strftime("%Y-%m-%d %H:%M:%S")
        
        print(f"{COLOR_GRAY}│{COLOR_RESET} {COLOR_CYAN}{str(idx).center(2)}{COLOR_GRAY}│{COLOR_RESET} {name_display} {COLOR_GRAY}│{COLOR_RESET} {size_display} {COLOR_GRAY}│{COLOR_RESET} {date_display} {COLOR_GRAY}│{COLOR_RESET}")
        
    print(f"{COLOR_GRAY}└───┴───────────────────────────────────────────┴────────────┴─────────────────────┘{COLOR_RESET}")

def process_file_with_openrouter_vision(filepath, mode, custom_prompt=None, api_key=None, model_name=None):
    """Encodes file and sends request to OpenRouter Chat Completions endpoint (for OCR/Extraction)."""
    # Safety notice for reranker models
    if "rerank" in model_name.lower():
        print(f"\n{COLOR_YELLOW}⚠️  WARNING: You are using a reranker model ({model_name}) for OCR text generation.")
        print(f"Reranking models do not support chat/completions and will likely result in an OpenRouter API error.{COLOR_RESET}\n")

    print(f"\n{COLOR_YELLOW}🔄 Reading and encoding file...{COLOR_RESET}")
    try:
        with open(filepath, "rb") as f:
            file_bytes = f.read()
        file_b64 = base64.b64encode(file_bytes).decode("utf-8")
    except Exception as e:
        print(f"{COLOR_RED}❌ Error reading file: {e}{COLOR_RESET}")
        return
        
    mime_type, _ = mimetypes.guess_type(filepath)
    if not mime_type:
        _, ext = os.path.splitext(filepath)
        ext = ext.lower()
        if ext in ['.jpg', '.jpeg']:
            mime_type = 'image/jpeg'
        elif ext == '.png':
            mime_type = 'image/png'
        elif ext == '.webp':
            mime_type = 'image/webp'
        elif ext == '.pdf':
            mime_type = 'application/pdf'
        else:
            mime_type = 'application/octet-stream'

    prompts = {
        "invoice": (
            "You are an expert invoice OCR and extraction tool. Analyze this document "
            "(image/PDF) and extract all major details. Structure it clearly using Markdown headers "
            "and tables. Try to find:\n"
            "- Vendor / Issuer Details (Name, Contact info, Tax IDs)\n"
            "- Invoice Details (Number, Date, Due Date, Reference)\n"
            "- Bill-To Details (Customer name, details)\n"
            "- Pricing Summary (Subtotal, taxes/GST/VAT, discounts, grand total amount and currency)\n"
            "- Payment Details (IBAN, bank account numbers, payment terms)\n"
            "- Line items list (description, qty, unit price, total for each item)\n\n"
            "Format the output clean and professional. Use markdown tables for the pricing summary and line items."
        ),
        "ocr": (
            "Perform a detailed raw OCR extraction on this document. Transcript all written details "
            "exactly as they appear in the original layout. Do not summarize or interpret. Maintain formatting, lines, "
            "and lists where possible."
        )
    }
    
    prompt = prompts.get(mode)
    if mode == "custom":
        prompt = custom_prompt if custom_prompt else "Describe this document details."

    payload = {
        "model": model_name,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text", 
                        "text": prompt
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{file_b64}"
                        }
                    }
                ]
            }
        ]
    }
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/hoppe/baileys-group-media-downloader",
        "X-OpenRouter-Title": "WhatsApp Group Media Downloader Bot"
    }
    
    print(f"{COLOR_YELLOW}🧠 Querying OpenRouter model ({model_name})...{COLOR_RESET}")
    
    try:
        response = requests.post(OPENROUTER_API_URL, headers=headers, json=payload)
        response_json = response.json()
        
        if response.status_code != 200:
            error_data = response_json.get("error", {})
            error_msg = error_data.get("message", "Unknown error occurred.")
            print(f"{COLOR_RED}❌ OpenRouter Request Failed ({response.status_code}): {error_msg}{COLOR_RESET}")
            return
            
        choices = response_json.get("choices", [])
        if not choices:
            print(f"{COLOR_RED}❌ No output returned from model. Structure received:{COLOR_RESET}")
            print(json.dumps(response_json, indent=2))
            return
            
        output_text = choices[0].get("message", {}).get("content", "")
        
        print(f"\n{COLOR_GREEN}{STYLE_BOLD}┌──────────────────────────────────────────────┐")
        print("│               ANALYSIS RESULTS               │")
        print(f"└──────────────────────────────────────────────┘{COLOR_RESET}\n")
        print(output_text)
        print(f"\n{COLOR_GRAY}────────────────────────────────────────────────{COLOR_RESET}")
        
    except Exception as e:
        print(f"{COLOR_RED}❌ Networking anomaly or parser error: {e}{COLOR_RESET}")

def main():
    os.system("") # Enable ANSI colors in Windows CMD/Powershell
    print(CLEAR_SCREEN, end="")
    print_banner()
    
    # 1. API Verification
    api_key = get_api_key()
    
    # 2. Path Setup
    media_dir = get_media_dir()
    print(f"\n📂 Scanning directory: {COLOR_CYAN}{media_dir}{COLOR_RESET}")
    
    # 3. Model Setup
    model_name = get_configured_model()
        
    while True:
        print(f"🤖 Active Model (OpenRouter): {COLOR_GREEN}{model_name}{COLOR_RESET}")
        
        files = list_media_files(media_dir)
        if not files:
            print(f"\n{COLOR_RED}⚠️  No valid media files found in: {media_dir}{COLOR_RESET}")
            print(f"Supported formats: .png, .jpg, .jpeg, .webp, .heic, .heif, .pdf")
            print(f"\nPlease check your Whatsapp downloader logs or copy files manually to the media folder.")
            
            input(f"\nPress Enter to re-scan files or Ctrl+C to exit...")
            print(CLEAR_SCREEN, end="")
            print_banner()
            continue
            
        show_file_menu(files)
        
        # User Picks File
        try:
            choice = input(f"\nSelect a file number (1-{len(files)}) [Default 1: Newest, 'm' to change model, 'r' to reload, 'q' to quit]: ").strip()
            
            if choice.lower() == 'q':
                print(f"\n{COLOR_GREEN}Goodbye!{COLOR_RESET}")
                break
            elif choice.lower() == 'r':
                print(CLEAR_SCREEN, end="")
                print_banner()
                continue
            elif choice.lower() == 'm':
                print(f"\n{STYLE_BOLD}Example vision/multimodal models on OpenRouter:{COLOR_RESET}")
                print("1. google/gemini-2.5-flash (Fast & highly accurate)")
                print("2. meta-llama/llama-3.2-11b-vision-instruct:free (Completely Free)")
                print("3. qwen/qwen-2-5-vl-72b-instruct:free (Completely Free, Great OCR)")
                print("4. Custom model ID")
                
                model_sel = input("\nSelect custom model ID or number: ").strip()
                if model_sel == "1":
                    model_name = "google/gemini-2.5-flash"
                elif model_sel == "2":
                    model_name = "meta-llama/llama-3.2-11b-vision-instruct:free"
                elif model_sel == "3":
                    model_name = "qwen/qwen-2-5-vl-72b-instruct:free"
                elif model_sel and model_sel not in ["1", "2", "3", "4"]:
                    model_name = model_sel
                elif model_sel == "4":
                    model_name = input("Enter exact model ID: ").strip()
                
                print(f"{COLOR_GREEN}Model updated to: {model_name}{COLOR_RESET}")
                print(CLEAR_SCREEN, end="")
                print_banner()
                continue
                
            if not choice:
                idx = 0 
            else:
                idx = int(choice) - 1
                if idx < 0 or idx >= len(files):
                    print(f"{COLOR_RED}❌ Out of range index, please try again.{COLOR_RESET}")
                    continue
        except ValueError:
            print(f"{COLOR_RED}❌ Invalid selection. Please enter a valid number.{COLOR_RESET}")
            continue
            
        selected_file = files[idx]
        print(f"\n🎯 Selected: {COLOR_GREEN}{selected_file['name']}{COLOR_RESET}")
        
        # Operation Menu Loop for the selected file
        while True:
            print(f"\n{STYLE_BOLD}Select extraction action for this file:{COLOR_RESET}")
            print(f" 1. {COLOR_CYAN}Extract invoice/receipt key details (Structured Markdown){COLOR_RESET}")
            print(f" 2. {COLOR_CYAN}Perform raw text OCR (Transcript all text){COLOR_RESET}")
            print(f" 3. {COLOR_CYAN}Interactive query (Ask custom question about the document){COLOR_RESET}")
            print(f" 4. {COLOR_YELLOW}Go back to file list / Refresh{COLOR_RESET}")
            
            action_choice = input(f"\nEnter choice (1-4) [default 1]: ").strip()
            if not action_choice:
                action_choice = "1"
                
            if action_choice == "1":
                process_file_with_openrouter_vision(selected_file["path"], "invoice", api_key=api_key, model_name=model_name)
            elif action_choice == "2":
                process_file_with_openrouter_vision(selected_file["path"], "ocr", api_key=api_key, model_name=model_name)
            elif action_choice == "3":
                custom = input(f"\n{COLOR_CYAN}🔎 What would you like to ask or find in this document?{COLOR_RESET}\nPrompt: ").strip()
                if custom:
                    process_file_with_openrouter_vision(selected_file["path"], "custom", custom_prompt=custom, api_key=api_key, model_name=model_name)
                else:
                    print(f"{COLOR_YELLOW}Prompt cancelled.{COLOR_RESET}")
            elif action_choice == "4":
                print(CLEAR_SCREEN, end="")
                print_banner()
                break
            else:
                print(f"{COLOR_RED}Invalid option. Enter 1, 2, 3 or 4.{COLOR_RESET}")

            input(f"\nPress Enter to continue editing this file or choose another option...")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n\n{COLOR_GREEN}Program terminated by user. Goodbye!{COLOR_RESET}")
        sys.exit(0)
