const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { google } = require('googleapis');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// ============ REPLACE THESE VALUES ============
const SPREADSHEET_ID = '1hNZ-vuH3N5kCz67SGh9bgZ00duvvF1AsL2iKDUwJZFg'; // Replace with your Google Sheet ID
const FOLDER_ID = '1KyoRjC5ofJzupLVSACVlfXAG3bAPXOJs'; // Replace with your Google Drive Folder ID
// Get these IDs from the URLs of your Google Sheet and Drive folder
// Sheet ID format: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
// Folder ID format: https://drive.google.com/drive/folders/FOLDER_ID
// ===========================================

// Configure multer for handling file uploads
const upload = multer({
    dest: 'temp_uploads/', // Temporary storage for files
    limits: {
        fileSize: 10 * 1024 * 1024, // Limit file size to 10MB
    }
});

// Initialize Google APIs
try {
    // ============ REPLACE THIS PATH ============
    const credentials = require("./bhcp-dispatch-backend-291e113a12ec.json");
    // Replace with the path to your downloaded JSON key file
    // Example: './service-account-key.json'
    // ===========================================

    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.file'
        ]
    });

    // Initialize Google Sheets API
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Initialize Google Drive API
    const drive = google.drive({ version: 'v3', auth });

    // Endpoint to upload file to Google Drive
    app.post('/api/upload', upload.single('file'), async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        try {
            // Upload file to Google Drive
            const fileMetadata = {
                name: req.file.originalname,
                parents: [FOLDER_ID] // Uses the folder ID you specified above
            };

            const media = {
                mimeType: req.file.mimetype,
                body: fs.createReadStream(req.file.path)
            };

            const driveResponse = await drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, webViewLink'
            });

            // Clean up: Delete temporary file
            fs.unlinkSync(req.file.path);

            res.json({
                success: true,
                fileId: driveResponse.data.id,
                webViewLink: driveResponse.data.webViewLink
            });

        } catch (error) {
            console.error('Error uploading file:', error);
            // Clean up: Delete temporary file if it exists
            if (req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Endpoint to add entry to Google Sheet
    app.post('/api/addEntry', async (req, res) => {
        try {
            const {
                dispatchNumber,
                date,
                subject,
                fileType,
                fileCategory,
                tags,
                user,
                files // Array of file objects with name and webViewLink
            } = req.body;

            // Format files for sheet entry
            const fileLinks = files.map(file => `${file.name}: ${file.webViewLink}`).join('\n');

            // Append row to Google Sheet
            await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: 'Sheet1!A:H', // Assumes first sheet with columns A through H
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[
                        dispatchNumber,
                        date,
                        subject,
                        fileType,
                        fileCategory,
                        tags,
                        user,
                        fileLinks
                    ]]
                }
            });

            res.json({ success: true });

        } catch (error) {
            console.error('Error adding entry:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Start the server
    app.listen(port, () => {
        console.log(`Backend server running on http://localhost:${port}`);
        console.log('Google APIs initialized successfully');
    });

} catch (error) {
    console.error('Failed to initialize Google APIs:', error);
    process.exit(1);
}

// Create temp_uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, 'temp_uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}