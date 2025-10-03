
// Configuration file for OpenAI Invoice Downloader
// Copy this file to config.js and fill in your details

module.exports = {
    // Your Gmail address
    email: "your-email@gmail.com",
    
    // Gmail App Password (16 characters)
    // Generate from: https://myaccount.google.com/apppasswords
    appPassword: "xxxx xxxx xxxx xxxx",
    
    // Email address to send invoices to
    receiverEmail: "your-email@gmail.com",
    
    // Your name (used in email subject)
    name: "Your Name",
    
    // Name to use in PDF filenames (no spaces)
    filenameName: "YourName",
    
    // OpenAI Payment Portal ID
    // Find this by going to OpenAI billing settings
    // The URL will be: https://pay.openai.com/p/login/XXXXXXXXX
    // Copy the XXXXXXXXX part
    openaiPayId: "XXXXXXXXX"
};