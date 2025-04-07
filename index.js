const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { google } = require('googleapis');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Constants
const SPREADSHEET_ID = '1hNZ-vuH3N5kCz67SGh9bgZ00duvvF1AsL2iKDUwJZFg';
const FOLDER_ID = '1KyoRjC5ofJzupLVSACVlfXAG3bAPXOJs';

// Configure multer for handling file uploads
const storage = multer.memoryStorage(); // Use memory storage instead of disk
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    }
});

// Initialize Google APIs
const initializeGoogleAPIs = () => {
    try {
        // Use environment variable for credentials
        const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
        
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/drive.file'
            ]
        });

        return {
            sheets: google.sheets({ version: 'v4', auth }),
            drive: google.drive({ version: 'v3', auth })
        };
    } catch (error) {
        console.error('Failed to initialize Google APIs:', error);
        throw error;
    }
};

// Root route
app.get('/', (req, res) => {
    res.send('Welcome to the BHCP Backend!');
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ message: 'Backend is working!' });
});

// Test credentials endpoint
app.get('/api/test-credentials', async (req, res) => {
    try {
        const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
        const { sheets } = initializeGoogleAPIs();
        
        // Test Google Sheets API
        await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID
        });

        res.json({
            success: true,
            message: 'Credentials are valid and Google Sheets API is accessible',
            projectId: credentials.project_id,
            clientEmail: credentials.client_email
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to validate credentials',
            message: error.message
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Endpoint to upload file to Google Drive
app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    try {
        const { drive } = initializeGoogleAPIs();

        // Upload file to Google Drive
        const fileMetadata = {
            name: req.file.originalname,
            parents: [FOLDER_ID]
        };

        const media = {
            mimeType: req.file.mimetype,
            body: req.file.buffer // Use the buffer instead of file system
        };

        const driveResponse = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id, webViewLink'
        });

        res.json({
            success: true,
            fileId: driveResponse.data.id,
            webViewLink: driveResponse.data.webViewLink
        });

    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint to add entry to Google Sheet
app.post('/api/addEntry', async (req, res) => {
    try {
        const { sheets } = initializeGoogleAPIs();
        
        const {
            dispatchNumber,
            date,
            subject,
            fileType,
            fileCategory,
            tags,
            user,
            files
        } = req.body;

        // Validate required fields
        if (!dispatchNumber || !date || !subject) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: dispatchNumber, date, and subject are required'
            });
        }

        // Format files for sheet entry
        const fileLinks = files.map(file => `${file.name}: ${file.webViewLink}`).join('\n');

        // Append row to Google Sheet
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:H',
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

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        error: 'Something went wrong!',
        message: err.message
    });
});

// Handle 404 errors
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Route not found'
    });
});

// Export the Express app
module.exports = app;