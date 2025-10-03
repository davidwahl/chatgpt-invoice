# OpenAI Invoice Downloader

Automated Node.js script to download OpenAI/ChatGPT invoices from the Stripe billing portal and email them to yourself.

> **Important (current limitation)**
>
> - This script **only supports Gmail** for reading login emails.
> - Your **ChatGPT/OpenAI billing account must use the same Gmail address** that you configure for IMAP access in this script.  
>   If they don’t match, the login link emails won’t be found and the script will fail.

## Features

- 🔐 Automatically requests login links from OpenAI billing portal
- 📧 Checks Gmail for login links via IMAP
- ⚡ Uses Stripe API for fast invoice retrieval (with browser fallback)
- 💾 Downloads invoices as PDF files with organized naming
- 📨 Emails downloaded invoices automatically
- 🎯 Smart retry logic and error handling
- 🕒 Timestamps on all log outputs for performance monitoring
- 🔄 Intelligent fallback from API to browser scraping when needed

## Prerequisites

- Node.js (version 18 or higher)
- A Gmail account with App Password enabled
- OpenAI payment portal ID

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/davidwahl/chatgpt-invoice.git
cd chatgpt-invoice
```

### 2. Install Dependencies

```bash
npm install
```

This will automatically:
- Install all required npm packages
- Download and install Chromium browser for Playwright

### 3. Configure the Script

Copy the example config file and fill in your details:

```bash
cp config.example.js config.js
```

Then edit `config.js` with your information (see Configuration section below).

## Configuration

Edit `config.js` with your information:

```javascript
module.exports = {
    email: "your-email@gmail.com",           // Your Gmail address
    appPassword: "xxxx xxxx xxxx xxxx",      // Gmail App Password
    receiverEmail: "your-email@gmail.com",   // Where to send invoices
    name: "Your Name",                       // Your name (for email subject)
    filenameName: "YourName",                // Name for PDF filenames (no spaces)
    openaiPayId: "XXXXXXXXX"                 // Your OpenAI payment portal ID
};
```

### Getting Your Gmail App Password

1. Go to your [Google Account Security Settings](https://myaccount.google.com/security)
2. Enable 2-Step Verification if not already enabled
3. Go to [App Passwords](https://myaccount.google.com/apppasswords)
4. Generate a new app password for "Mail"
5. Copy the 16-character password (format: `xxxx xxxx xxxx xxxx`)

### Finding Your OpenAI Payment Portal ID

The Payment Portal ID is required for the script to request login links. Here's how to find it:

1. Log into [ChatGPT](https://chat.openai.com)
2. Open your browser's Developer Tools (F12 or right-click → Inspect)
3. Go to the **Network** tab in Developer Tools
4. Filter to show only **Fetch/XHR** requests
5. In ChatGPT, go to **Settings** → **Account** → **Payment**
6. Click the **"Manage"** button
7. In the Network tab, look for the **first** request with the format:
   ```
   /v1/billing_portal/sessions/bps_xxxxxxxxxxxxxxxxxxxxxxxx
   ```
8. Click on this request to view its details
9. Go to the **Response** tab
10. Scroll down in the JSON response to find the `login_page` object
11. Look for the `url` property inside `login_page`:
    ```json
    "login_page": {
      "enabled": true,
      "url": "https://pay.openai.com/p/login/xxxxxxxxxxxxxxxxxx"
    }
    ```
12. Copy the part after `/login/` - this is your Payment Portal ID

Add this ID to your `config.js` file as the `openaiPayId` value.

## Usage

### Quick Start

```bash
# Download most recent invoice
npm start

# Download all available invoices
npm run download

# List invoices without downloading
npm run list
```

### Command Line Options

```bash
node invoice-downloader.js [options]
```

| Option | Description |
|--------|-------------|
| `--request` | Force request a new login link instead of checking existing emails |
| `--download-dir <dir>` | Specify download directory (default: `invoices`) |
| `--no-headless` | Run browser in visible mode (useful for debugging) |
| `--all-invoices` | Download all available invoices instead of just the most recent |
| `--list-only` | List available invoices without downloading them |

### Examples

**Download all invoices:**
```bash
node invoice-downloader.js --all-invoices
```

**Request new login link first:**
```bash
node invoice-downloader.js --request
```

**Download to custom directory:**
```bash
node invoice-downloader.js --download-dir ./my-invoices
```

**Just list invoices without downloading:**
```bash
node invoice-downloader.js --list-only
```

**Run with visible browser (debugging):**
```bash
node invoice-downloader.js --no-headless
```

**Combine multiple options:**
```bash
node invoice-downloader.js --request --all-invoices --download-dir ./invoices-2025
```

## How It Works

1. **Check Email**: Monitors your Gmail inbox for login link emails from Stripe/OpenAI
2. **Extract Credentials**: Uses native HTTPS to quickly extract session ID and bearer token from the login URL
3. **Fetch via API**: Calls Stripe's API to get complete invoice data (10+ invoices with full details)
4. **Download PDFs**: Uses native fetch() to download invoice PDFs directly from provided URLs
5. **Email Invoices**: Automatically emails each downloaded invoice to your specified address
6. **Smart Fallback**: If API method fails, falls back to browser automation for reliability

The script prioritizes speed and efficiency:
- **Primary method**: Native HTTPS + API calls (no browser needed - very fast)
- **Fallback method**: Playwright browser automation (when API requires full session context)
- **Always works**: Multiple fallback strategies ensure the script completes successfully

## Output

### Downloaded Files

Invoices are saved with the following naming format:
```
OpenAI_YYYY-MM-DD_YourName.pdf
```

Example: `OpenAI_2025-09-11_DavidWahl.pdf`

### Email Notifications

Each downloaded invoice triggers an automatic email with:
- Subject: `ChatGPT Invoice for [Your Name] [Invoice Date]`
- Attachment: The downloaded PDF invoice
- Body: Simple notification that the invoice was automatically downloaded

## Performance

The script is highly optimized for speed:
- **Primary method (API)**: ~10-15 seconds total
  - Gmail check: ~3 seconds
  - Credential extraction: ~1 second  
  - API fetch: ~1 second
  - Download + email per invoice: ~3 seconds
- **Fallback method (browser)**: ~25-30 seconds total
- **With expired login URL**: ~1 minute (includes requesting new link + email wait time)

### Performance Breakdown
- Native HTTPS credential extraction (no browser overhead)
- Direct Stripe API calls for invoice data (10+ invoices instantly)
- Native fetch() for PDF downloads (no browser needed)
- Playwright only used when necessary (requesting links, fallback scraping)

**Expected runtime with valid login URL**: 10-15 seconds for downloading most recent invoice

## Troubleshooting

### "Error: config.js not found"

- Copy `config.example.js` to `config.js` and fill in your details

### "IMAP error" or "Authentication failed"

- Double-check your Gmail address and App Password in `config.js`
- Ensure 2-Step Verification is enabled on your Google account
- Make sure you're using an App Password, not your regular password
- Verify IMAP is enabled in Gmail settings (Settings → Forwarding and POP/IMAP)

### "No login link found"

- The script will automatically request a new link after several failed attempts
- Use `--request` flag to force a new login link request
- Check your spam folder for emails from Stripe/OpenAI

### "Login link appears to be expired"

- Login links expire after ~30 minutes
- The script will automatically request a new link
- You can manually trigger with `--request` flag

### "API request failed: 401 Unauthorized"

- The login URL may have expired - script will automatically request a new one
- If persistent, the script will fall back to browser scraping method

### Browser/Playwright Issues

If you encounter browser-related errors:
```bash
# Reinstall Playwright browsers
npx playwright install --force chromium
```

## File Structure

```
.
├── invoice-downloader.js    # Main script
├── config.js               # Your configuration (not in git)
├── config.example.js       # Example configuration
├── package.json            # Node dependencies
├── .gitignore             # Git ignore rules
├── README.md              # This file
└── invoices/              # Downloaded PDFs (created automatically)
    └── OpenAI_2025-09-11_YourName.pdf
```

## Automation

### Run on Schedule (Cron/Task Scheduler)

Automate the script to run monthly to automatically download new invoices.

**Linux/Mac (crontab):**
```bash
# Edit crontab
crontab -e

# Add line to run on the 1st of each month at 9 AM
0 9 1 * * cd /path/to/chatgpt-invoice && node invoice-downloader.js
```

**Windows (Task Scheduler):**
1. Open Task Scheduler
2. Create Basic Task
3. Set trigger to monthly (e.g., 1st of each month)
4. Action: Start a program
5. Program: `node`
6. Arguments: `invoice-downloader.js`
7. Start in: `C:\path\to\chatgpt-invoice`

## Security Notes

- **config.js is gitignored** - Your credentials are safe from accidental commits
- The Gmail App Password only has access to your Gmail, not your full Google account
- Login links expire after ~24 hours for security
- All credentials are stored locally in `config.js` only

## Dependencies

- **imap**: Gmail IMAP access for checking emails
- **mailparser**: Parse email messages to extract content
- **nodemailer**: Send emails with attachments
- **playwright**: Browser automation (used for requesting login links and fallback scraping)
- **commander**: Command-line argument parsing

## Changelog

### Version 1.0.0 (Current)
- Initial release
- Stripe API integration for fast invoice retrieval (10+ invoices instantly)
- Native HTTPS credential extraction (no browser overhead)
- Native fetch() for all PDF downloads
- Configuration file system for easy setup and git sharing
- npm scripts for common tasks
- Intelligent fallback from API to browser scraping
- Performance optimized: 10-15 seconds for typical use
- Timestamps on all log outputs
- Comprehensive error handling and retry logic
- Automatic Chromium installation via postinstall script

## Contributing

Feel free to submit issues or pull requests if you find bugs or have suggestions for improvements.

## Author

**David Helland Wahl**
- Email: david@fluxloop.com
- GitHub: [@davidwahl](https://github.com/davidwahl)

## License

MIT License - Feel free to modify and use for your personal or commercial projects.

## Acknowledgments

This project automates the process of downloading OpenAI invoices each month, using a combination of Stripe's API and intelligent fallback mechanisms to ensure reliable operation.