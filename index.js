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

// Store last dispatch numbers in memory
let lastDispatchNumbers = {
    letters: 0,  // For "Letter" type (will store the next starting number)
    others: 0    // For other file types
};

// Function to get the last numbers from Google Sheet
async function updateLastNumbersFromSheet() {
    try {
        const { sheets } = initializeGoogleAPIs();
        
        // Get all values from the sheet
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:D'  // Get dispatch numbers and file types
        });

        const rows = response.data.values || [];
        
        // Skip header row if it exists
        const dataRows = rows.slice(1);
        
        // Process each row to find the highest numbers
        dataRows.forEach(row => {
            if (row[0] && row[3]) {  // If dispatch number and file type exist
                const dispatchNum = row[0];  // Column A: Dispatch Number
                const fileType = row[3];     // Column D: File Type

                if (fileType === 'Letter') {
                    // Extract the ending number from format No.BHCP/year/category/NNNN-XXX
                    const match = dispatchNum.match(/(\d+)-(\d+)$/);
                    if (match) {
                        const endNumber = parseInt(match[2]);
                        // Store the next starting number (end number + 1)
                        const nextStartingNumber = endNumber + 1;
                        lastDispatchNumbers.letters = Math.max(lastDispatchNumbers.letters, nextStartingNumber);
                    }
                } else {
                    // Extract the last number from format No.BHCP/category/year/XXX
                    const match = dispatchNum.match(/(\d+)$/);
                    if (match) {
                        const lastNumber = parseInt(match[1]);
                        // Store the next number
                        const nextNumber = lastNumber + 1;
                        lastDispatchNumbers.others = Math.max(lastDispatchNumbers.others, nextNumber);
                    }
                }
            }
        });

        console.log('Updated last numbers from sheet (next starting numbers):', lastDispatchNumbers);
    } catch (error) {
        console.error('Error updating last numbers from sheet:', error);
    }
}

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

// Get last dispatch numbers endpoint
app.get('/api/lastDispatchNumbers', async (req, res) => {
    try {
        // Update numbers from sheet before sending
        await updateLastNumbersFromSheet();
        res.json({
            success: true,
            lastDispatchNumbers
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get last dispatch numbers',
            message: error.message
        });
    }
});

// Update last dispatch number endpoint
app.post('/api/updateLastDispatchNumber', (req, res) => {
    const { type, newTotal } = req.body;

    if (type === 'Letter') {
        // For letters, store the next starting number
        lastDispatchNumbers.letters = parseInt(newTotal) + 1;
    } else {
        // For others, store the next number
        lastDispatchNumbers.others = parseInt(newTotal) + 1;
    }

    res.json({
        success: true,
        lastDispatchNumbers
    });
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
        if (!dispatchNumber || !date || !subject || !fileType || !fileCategory) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: dispatchNumber, date, subject, fileType, and fileCategory are required'
            });
        }

        // Format files for sheet entry
        const fileLinks = files.map(file => `${file.name}: ${file.webViewLink}`).join('\n');

        // Prepare the row data
        const rowData = [
            dispatchNumber,
            date,
            subject,
            fileType,
            fileCategory,
            tags,
            user,
            fileLinks
        ];

        // Append row to Google Sheet
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:H',
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [rowData]
            }
        });

        // Update the next starting number after successful entry
        if (fileType === 'Letter') {
            const match = dispatchNumber.match(/(\d+)-(\d+)$/);
            if (match) {
                const endNumber = parseInt(match[2]);
                // Store the next starting number
                lastDispatchNumbers.letters = endNumber + 1;
            }
        } else {
            const match = dispatchNumber.match(/(\d+)$/);
            if (match) {
                const number = parseInt(match[1]);
                // Store the next number
                lastDispatchNumbers.others = number + 1;
            }
        }

        res.json({ 
            success: true,
            message: 'Entry added successfully',
            data: {
                dispatchNumber,
                date,
                subject,
                fileType,
                fileCategory,
                tags,
                user,
                files: files.length
            }
        });

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