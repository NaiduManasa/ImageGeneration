// app.js
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { spawn } = require('child_process'); // For running Python/FFmpeg processes
const fs = require('fs');
const cookieParser = require('cookie-parser');
// const axios = require('axios'); // Removed or commented out as API integration is set aside

// Load environment variables
dotenv.config();

// Define paths to executables/environments
const PYTHON_EXE_PATH = path.join(__dirname, 'venv_ml', 'Scripts', 'python.exe'); // Path to your virtual environment's python.exe
const FFMPEG_NODE_PATH = "C:\\ffmpeg\\ffmpeg-master-latest-win64-gpl\\bin\\ffmpeg.exe"; // Correct absolute path to ffmpeg.exe

// Ensure API Key is loaded if you decide to re-enable API integration later
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
if (!STABILITY_API_KEY) {
    console.warn('WARNING: STABILITY_API_KEY is not set in .env file. API video generation will not work.');
}


const app = express();
const PORT = process.env.PORT || 3000;

// --- Database Connection ---
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Atlas Connected'))
    .catch(err => console.error('MongoDB connection error:', err));

// --- Mongoose Models ---
const User = require('./models/User');
const GeneratedContent = require('./models/GeneratedContent');

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/storage', express.static(path.join(__dirname, 'storage')));

// --- Authentication Middleware for HTML pages ---
const requireAuth = (req, res, next) => {
    const token = req.cookies.token;

    if (!token) {
        return res.redirect('/login');
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded.user;
        next();
    } catch (err) {
        res.clearCookie('token');
        return res.redirect('/login');
    }
};

// Middleware for API routes that need user ID (returns 401, doesn't redirect HTML)
const authenticateAPI = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        req.user = null;
        return res.status(401).json({ success: false, msg: 'Unauthorized. No token provided.' });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded.user;
        next();
    } catch (err) {
        res.clearCookie('token');
        return res.status(401).json({ success: false, msg: 'Unauthorized. Invalid token.' });
    }
};

// --- Multer Setup for File Uploads ---
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// --- HTML Page Routes ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/app', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/login', (req, res) => {
    if (req.cookies.token) {
        try {
            jwt.verify(req.cookies.token, process.env.JWT_SECRET);
            return res.redirect('/app');
        } catch (err) {
            res.clearCookie('token');
        }
    }
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/register', (req, res) => {
    if (req.cookies.token) {
        try {
            jwt.verify(req.cookies.token, process.env.JWT_SECRET);
            return res.redirect('/app');
        } catch (err) {
            res.clearCookie('token');
        }
    }
    res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

// --- API Endpoints ---

// Register User
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ success: false, msg: 'User already exists' });
        }
        user = new User({ username, email, password });
        await user.save();

        const payload = { user: { id: user.id } };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.cookie('token', token, { httpOnly: true, maxAge: 3600000 });
        res.status(200).json({ success: true, msg: 'Registration successful!' });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ success: false, msg: 'Server error during registration' });
    }
});

// Login User
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ success: false, msg: 'Invalid Credentials' });
        }

        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            return res.status(400).json({ msg: 'Invalid Credentials' });
        }

        const payload = { user: { id: user.id } };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.cookie('token', token, { httpOnly: true, maxAge: 3600000 });
        res.status(200).json({ success: true, msg: 'Login successful!' });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ success: false, msg: 'Server error during login' });
    }
});

// Logout User
app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.status(200).json({ success: true, msg: 'Logged out successfully' });
});

// Image Generation from Text Prompt (Local CPU-bound Stable Diffusion)
app.post('/api/generate/image', authenticateAPI, async (req, res) => {
    const { prompt } = req.body;
    const userId = req.user.id;

    if (!prompt) {
        return res.status(400).json({ success: false, msg: 'Prompt is required' });
    }

    const newContent = new GeneratedContent({ userId, type: 'image', prompt, filePath: '', status: 'pending' });
    await newContent.save();

    res.status(202).json({ success: true, msg: 'Image generation started. Check gallery soon.', contentId: newContent._id });

    const pythonProcess = spawn(PYTHON_EXE_PATH, [ // Use absolute Python path
        path.join(__dirname, 'ml_scripts', 'image_gen.py'),
        prompt,
        newContent._id.toString()
    ]);

    let outputResult = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (data) => { outputResult += data.toString().trim(); });
    pythonProcess.stderr.on('data', (data) => { errorOutput += data.toString(); });

    pythonProcess.on('close', async (code) => {
        if (code === 0) {
            newContent.filePath = outputResult;
            newContent.status = 'completed';
            await newContent.save();
            console.log(`Image generated for ${userId}: ${outputResult}`);
        } else {
            newContent.status = 'failed';
            await newContent.save();
            console.error(`Image generation failed for ${userId}: Code ${code}, Error: ${errorOutput}`);
        }
    });
    // Add error listener for spawn process itself
    pythonProcess.on('error', (err) => {
        console.error(`Failed to start Python process for image generation: ${err.message}`);
        newContent.status = 'failed';
        newContent.save();
    });
});


// Video Generation from Text Prompt (Local Python Script with FFmpeg)
app.post('/api/generate/video/text', authenticateAPI, async (req, res) => {
    const { prompt } = req.body;
    const userId = req.user.id;

    if (!prompt) {
        return res.status(400).json({ success: false, msg: 'Prompt is required' });
    }

    const newContent = new GeneratedContent({
        userId,
        type: 'video',
        prompt,
        filePath: '', // Will be updated by the Python script
        status: 'pending'
    });
    await newContent.save();

    res.status(202).json({ success: true, msg: 'Video generation from text started. Check gallery soon.', contentId: newContent._id });

    // Use absolute Python path to run the video_gen_text.py script
    const pythonProcess = spawn(PYTHON_EXE_PATH, [
        path.join(__dirname, 'ml_scripts', 'video_gen_text.py'),
        prompt,
        newContent._id.toString()
    ]);

    let outputResult = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (data) => { outputResult += data.toString().trim(); });
    pythonProcess.stderr.on('data', (data) => { errorOutput += data.toString(); });

    pythonProcess.on('close', async (code) => {
        if (code === 0) {
            newContent.filePath = outputResult;
            newContent.status = 'completed';
            await newContent.save();
            console.log(`Video generated from text for ${userId}: ${outputResult}`);
        } else {
            newContent.status = 'failed';
            await newContent.save();
            console.error(`Video generation from text failed for ${userId}: Code ${code}, Error: ${errorOutput}`);
        }
    });
    // Add error listener for spawn process itself
    pythonProcess.on('error', (err) => {
        console.error(`Failed to start Python process for text-to-video generation: ${err.message}`);
        newContent.status = 'failed';
        newContent.save();
    });
});

// Video Generation from File (Supports Image or PDF input)
app.post('/api/generate/video/file', authenticateAPI, upload.single('sourceFile'), async (req, res) => {
    const userId = req.user.id;

    if (!req.file) {
        return res.status(400).json({ success: false, msg: 'No file uploaded.' });
    }

    const inputFile = req.file.path; // Path to the temporarily uploaded file by Multer
    const originalFileName = req.file.originalname;
    const fileMimeType = req.file.mimetype;

    // Determine content type and script/command to use
    let pythonScriptToRun = null;
    let ffmpegArgs = [];
    let processingType = ''; // 'image-loop' or 'pdf-sequence'
    let outputFileName = '';
    let outputPath = '';

    if (fileMimeType.startsWith('image/')) {
        processingType = 'image-loop';
        outputFileName = `video_${Date.now()}_${userId}.mp4`;
        outputPath = path.join(__dirname, 'storage', 'videos', outputFileName);
        
        ffmpegArgs = [
            '-loop', '1',
            '-i', inputFile,
            '-c:v', 'libx264',
            '-t', '5', // 5 seconds duration for looped image
            '-pix_fmt', 'yuv420p',
            '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
            outputPath
        ];
    } else if (fileMimeType === 'application/pdf') {
        processingType = 'pdf-sequence';
        pythonScriptToRun = path.join(__dirname, 'ml_scripts', 'pdf_to_video.py');
        outputFileName = `video_pdf_${Date.now()}_${userId}.mp4`; // Naming for PDF-generated videos
        outputPath = path.join(__dirname, 'storage', 'videos', outputFileName); // Final video path will be returned by Python
    } else {
        // Clean up the temporary uploaded file if it's an unsupported type
        fs.unlink(inputFile, (unlinkErr) => {
            if (unlinkErr) console.error('Error deleting unsupported temp upload file:', unlinkErr);
        });
        return res.status(400).json({ success: false, msg: 'Unsupported file type. Please upload an image or PDF.' });
    }

    const newContent = new GeneratedContent({
        userId,
        type: 'video',
        prompt: `Video from file: ${originalFileName} (${processingType})`,
        filePath: `storage/videos/${outputFileName}`, // This will be updated for PDF after script returns path
        status: 'pending'
    });
    await newContent.save();

    res.status(202).json({ success: true, msg: 'Video generation from file started. Check gallery soon.', contentId: newContent._id });

    try {
        if (processingType === 'image-loop') {
            const ffmpegProcess = spawn(FFMPEG_NODE_PATH, ffmpegArgs);

            ffmpegProcess.stderr.on('data', (data) => {
                console.error(`FFmpeg stderr (image-to-video): ${data.toString()}`);
            });

            ffmpegProcess.on('close', async (code) => {
                fs.unlink(inputFile, (unlinkErr) => {
                    if (unlinkErr) console.error('Error deleting temp upload file:', unlinkErr);
                });

                if (code === 0) {
                    newContent.status = 'completed';
                    await newContent.save();
                    console.log(`Video generated from image file for ${userId}: ${outputPath}`);
                } else {
                    console.error(`FFmpeg process exited with code ${code} for image-to-video.`);
                    newContent.status = 'failed';
                    await newContent.save();
                }
            });
            ffmpegProcess.on('error', (err) => {
                console.error(`Failed to start FFmpeg process for image-to-video: ${err.message}`);
                newContent.status = 'failed';
                newContent.save();
            });
        } else if (processingType === 'pdf-sequence') {
            const pythonProcess = spawn(PYTHON_EXE_PATH, [
                pythonScriptToRun,
                inputFile,
                newContent._id.toString()
            ]);

            let outputResult = '';
            let errorOutput = '';

            pythonProcess.stdout.on('data', (data) => { outputResult += data.toString().trim(); });
            pythonProcess.stderr.on('data', (data) => { errorOutput += data.toString(); });

            pythonProcess.on('close', async (code) => {
                fs.unlink(inputFile, (unlinkErr) => { // Clean up the temporary uploaded PDF file
                    if (unlinkErr) console.error('Error deleting temp PDF upload file:', unlinkErr);
                });

                if (code === 0) {
                    // Python script prints the relative path of the generated video
                    const finalVideoPath = outputResult; // e.g., storage/videos/video_pdf_xxx.mp4
                    newContent.filePath = finalVideoPath;
                    newContent.status = 'completed';
                    await newContent.save();
                    console.log(`Video generated from PDF for ${userId}: ${finalVideoPath}`);
                } else {
                    newContent.status = 'failed';
                    await newContent.save();
                    console.error(`PDF to video generation failed for ${userId}: Code ${code}, Error: ${errorOutput}`);
                }
            });
            pythonProcess.on('error', (err) => {
                console.error(`Failed to start Python process for PDF-to-video generation: ${err.message}`);
                newContent.status = 'failed';
                newContent.save();
            });
        }

    } catch (err) {
        console.error(`Error in file-to-video route: ${err.message}`);
        newContent.status = 'failed';
        await newContent.save();
    }
});
// // Video Generation from File (Using local FFmpeg with explicit path)
// app.post('/api/generate/video/file', authenticateAPI, upload.single('sourceFile'), async (req, res) => {
//     const userId = req.user.id;
//     console.log('Multer received file:', req.file); // Add this line

//     if (!req.file) {
//         return res.status(400).json({ success: false, msg: 'No file uploaded.' });
//     }

//     const inputFile = req.file.path; // Path to the temporarily uploaded file by Multer
//     const outputFileName = `video_${Date.now()}_${userId}.mp4`;
//     const outputPath = path.join(__dirname, 'storage', 'videos', outputFileName);

//     const newContent = new GeneratedContent({
//         userId,
//         type: 'video',
//         prompt: `Video from file: ${req.file.originalname}`,
//         filePath: `storage/videos/${outputFileName}`,
//         status: 'pending'
//     });
//     await newContent.save();

//     res.status(202).json({ success: true, msg: 'Video generation from file started. Check gallery soon.', contentId: newContent._id });

//     try {
//         const ffmpegArgs = [
//             '-loop', '1',
//             '-i', inputFile,
//             '-c:v', 'libx264',
//             '-t', '5',
//             '-pix_fmt', 'yuv420p',
//             '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
//             outputPath
//         ];

//         // Use the explicit FFmpeg path
//         const ffmpegProcess = spawn(FFMPEG_NODE_PATH, ffmpegArgs); // Correct use of global constant

//         ffmpegProcess.stderr.on('data', (data) => {
//             console.error(`FFmpeg stderr (file-to-video): ${data.toString()}`); // Log FFmpeg errors for debugging
//         });

//         ffmpegProcess.on('close', async (code) => {
//             // Clean up the temporary uploaded file
//             fs.unlink(inputFile, (unlinkErr) => {
//                 if (unlinkErr) console.error('Error deleting temp upload file:', unlinkErr);
//             });

//             if (code === 0) {
//                 newContent.status = 'completed';
//                 await newContent.save();
//                 console.log(`Video generated from file for ${userId}: ${outputPath}`);
//             } else {
//                 console.error(`FFmpeg process exited with code ${code} for file-to-video.`);
//                 newContent.status = 'failed';
//                 await newContent.save();
//             }
//         });
//         // Add error listener for spawn process itself
//         ffmpegProcess.on('error', (err) => { // Catch spawn errors (like ENOENT if path is still wrong, though unlikely now)
//             console.error(`Failed to start FFmpeg process for file-to-video: ${err.message}`);
//             newContent.status = 'failed';
//             newContent.save();
//         });

//     } catch (err) {
//         console.error(`Error in file-to-video route: ${err.message}`);
//         newContent.status = 'failed';
//         await newContent.save();
//     }
// });

// Get User Gallery Data
app.get('/api/gallery', authenticateAPI, async (req, res) => {
    try {
        const galleryItems = await GeneratedContent.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.json({ success: true, gallery: galleryItems });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ success: false, msg: 'Server error fetching gallery' });
    }
});

// Start the server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));









// // app.js
// const express = require('express');
// const mongoose = require('mongoose');
// const path = require('path');
// const dotenv = require('dotenv');
// const bcrypt = require('bcryptjs');
// const jwt = require('jsonwebtoken');
// const multer = require('multer');
// const { spawn } = require('child_process');
// const fs = require('fs');
// const cookieParser = require('cookie-parser');
// const FFMPEG_NODE_PATH = "C:\\ffmpeg\\ffmpeg-master-latest-win64-gpl\\bin\\ffmpeg.exe";

// // Load environment variables
// dotenv.config();

// const app = express();
// const PORT = process.env.PORT || 3000;

// // --- Database Connection ---
// const MONGO_URI = process.env.MONGO_URI;
// mongoose.connect(MONGO_URI)
//     .then(() => console.log('MongoDB Atlas Connected'))
//     .catch(err => console.error('MongoDB connection error:', err));

// // --- Mongoose Models ---
// const User = require('./models/User');
// const GeneratedContent = require('./models/GeneratedContent');

// // --- Middleware ---
// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
// app.use(cookieParser());

// // Serve static files
// app.use(express.static(path.join(__dirname, 'public')));
// app.use('/storage', express.static(path.join(__dirname, 'storage')));

// // --- Authentication Middleware for HTML pages ---
// // This middleware now only applies to the /app route, ensuring it's protected.
// const requireAuth = (req, res, next) => {
//     const token = req.cookies.token;

//     if (!token) {
//         // If no token, redirect to login page for HTML requests
//         return res.redirect('/login');
//     }

//     try {
//         const decoded = jwt.verify(token, process.env.JWT_SECRET);
//         req.user = decoded.user;
//         next();
//     } catch (err) {
//         // If token invalid, clear cookie and redirect to login
//         res.clearCookie('token');
//         return res.redirect('/login');
//     }
// };

// // Middleware for API routes that need user ID (returns 401, doesn't redirect HTML)
// const authenticateAPI = (req, res, next) => {
//     const token = req.cookies.token;
//     if (!token) {
//         req.user = null; // No user attached if no token
//         return res.status(401).json({ success: false, msg: 'Unauthorized. No token provided.' });
//     }
//     try {
//         const decoded = jwt.verify(token, process.env.JWT_SECRET);
//         req.user = decoded.user;
//         next();
//     } catch (err) {
//         res.clearCookie('token'); // Clear invalid token
//         return res.status(401).json({ success: false, msg: 'Unauthorized. Invalid token.' });
//     }
// };

// // --- Multer Setup for File Uploads ---
// const uploadDir = path.join(__dirname, 'public', 'uploads');
// if (!fs.existsSync(uploadDir)) {
//     fs.mkdirSync(uploadDir, { recursive: true });
// }
// const upload = multer({
//     dest: uploadDir,
//     limits: { fileSize: 10 * 1024 * 1024 }
// });

// // --- HTML Page Routes ---

// // Default root route: ALWAYS serves the login page
// app.get('/', (req, res) => {
//     res.sendFile(path.join(__dirname, 'views', 'login.html'));
// });

// // Main application page - now at '/app', requires authentication
// app.get('/app', requireAuth, (req, res) => {
//     res.sendFile(path.join(__dirname, 'views', 'index.html'));
// });

// // Explicit login page route (users can still type /login)
// app.get('/login', (req, res) => {
//     // If they explicitly go to /login but ARE authenticated, redirect to app
//     if (req.cookies.token) {
//         try {
//             jwt.verify(req.cookies.token, process.env.JWT_SECRET);
//             return res.redirect('/app');
//         } catch (err) {
//             res.clearCookie('token'); // Clear invalid token
//         }
//     }
//     res.sendFile(path.join(__dirname, 'views', 'login.html'));
// });

// // Register page
// app.get('/register', (req, res) => {
//     // If they explicitly go to /register but ARE authenticated, redirect to app
//     if (req.cookies.token) {
//         try {
//             jwt.verify(req.cookies.token, process.env.JWT_SECRET);
//             return res.redirect('/app');
//         } catch (err) {
//             res.clearCookie('token'); // Clear invalid token
//         }
//     }
//     res.sendFile(path.join(__dirname, 'views', 'register.html'));
// });

// // --- API Endpoints (These remain the same as before) ---

// // Register User
// app.post('/api/register', async (req, res) => {
//     const { username, email, password } = req.body;
//     try {
//         let user = await User.findOne({ email });
//         if (user) {
//             return res.status(400).json({ success: false, msg: 'User already exists' });
//         }
//         user = new User({ username, email, password });
//         await user.save();

//         const payload = { user: { id: user.id } };
//         const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

//         // IMPORTANT: We set the cookie, but the client-side JS still handles the redirect to /login
//         res.cookie('token', token, { httpOnly: true, maxAge: 3600000 });
//         res.status(200).json({ success: true, msg: 'Registration successful!' });

//     } catch (err) {
//         console.error(err.message);
//         res.status(500).json({ success: false, msg: 'Server error during registration' });
//     }
// });

// // Login User
// app.post('/api/login', async (req, res) => {
//     const { email, password } = req.body;
//     try {
//         const user = await User.findOne({ email });
//         if (!user) {
//             return res.status(400).json({ success: false, msg: 'Invalid Credentials' });
//         }

//         const isMatch = await user.matchPassword(password);
//         if (!isMatch) {
//             return res.status(400).json({ success: false, msg: 'Invalid Credentials' });
//         }

//         const payload = { user: { id: user.id } };
//         const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

//         // Setting the cookie here. The client-side JS on login.html handles the redirect to /app.
//         res.cookie('token', token, { httpOnly: true, maxAge: 3600000 });
//         res.status(200).json({ success: true, msg: 'Login successful!' });

//     } catch (err) {
//         console.error(err.message);
//         res.status(500).json({ success: false, msg: 'Server error during login' });
//     }
// });

// // Logout User
// app.post('/api/logout', (req, res) => {
//     res.clearCookie('token');
//     res.status(200).json({ success: true, msg: 'Logged out successfully' });
// });

// // Image Generation from Text Prompt
// app.post('/api/generate/image', authenticateAPI, async (req, res) => {
//     const { prompt } = req.body;
//     const userId = req.user.id; // Guaranteed by authenticateAPI

//     if (!prompt) {
//         return res.status(400).json({ success: false, msg: 'Prompt is required' });
//     }

//     const newContent = new GeneratedContent({ userId, type: 'image', prompt, filePath: '', status: 'pending' });
//     await newContent.save();

//     res.status(202).json({ success: true, msg: 'Image generation started. Check gallery soon.', contentId: newContent._id });

//     const pythonProcess = spawn('python', [
//         path.join(__dirname, 'ml_scripts', 'image_gen.py'),
//         prompt,
//         newContent._id.toString()
//     ]);

//     let outputResult = '';
//     let errorOutput = '';

//     pythonProcess.stdout.on('data', (data) => { outputResult += data.toString().trim(); });
//     pythonProcess.stderr.on('data', (data) => { errorOutput += data.toString(); });

//     pythonProcess.on('close', async (code) => {
//         if (code === 0) {
//             newContent.filePath = outputResult;
//             newContent.status = 'completed';
//             await newContent.save();
//             console.log(`Image generated for ${userId}: ${outputResult}`);
//         } else {
//             newContent.status = 'failed';
//             await newContent.save();
//             console.error(`Image generation failed for ${userId}: Code ${code}, Error: ${errorOutput}`);
//         }
//     });
// });


// app.post('/api/generate/video/text', authenticateAPI, async (req, res) => {
//     const { prompt } = req.body;
//     const userId = req.user.id; // Guaranteed by authenticateAPI

//     if (!prompt) {
//         return res.status(400).json({ success: false, msg: 'Prompt is required' });
//     }

//     // Create a pending entry in DB
//     const newContent = new GeneratedContent({
//         userId,
//         type: 'video',
//         prompt,
//         filePath: '', // Will be updated by the Python script
//         status: 'pending'
//     });
//     await newContent.save();

//     res.status(202).json({ success: true, msg: 'Video generation from text started. Check gallery soon.', contentId: newContent._id });

//     // --- CRITICAL "NO API" PART: Run your local ML Model for Text-to-Video ---
//     // This assumes you have a Python script in ./ml_scripts/video_gen_text.py
//     // that takes a prompt and outputs the relative path to the generated video file to stdout.
//     const pythonProcess = spawn('python', [
//         path.join(__dirname, 'ml_scripts', 'video_gen_text.py'),
//         prompt,
//         newContent._id.toString() // Pass content ID for unique filename
//     ]);

//     let outputResult = '';
//     let errorOutput = '';

//     pythonProcess.stdout.on('data', (data) => {
//         outputResult += data.toString().trim(); // Expecting the relative file path
//     });

//     pythonProcess.stderr.on('data', (data) => {
//         errorOutput += data.toString();
//     });

//     pythonProcess.on('close', async (code) => {
//         if (code === 0) {
//             newContent.filePath = outputResult; // e.g., 'storage/videos/video_abcdef123.mp4'
//             newContent.status = 'completed';
//             await newContent.save();
//             console.log(`Video generated from text for ${userId}: ${outputResult}`);
//         } else {
//             newContent.status = 'failed';
//             await newContent.save();
//             console.error(`Video generation from text failed for ${userId}: Code ${code}, Error: ${errorOutput}`);
//         }
//     });
// });



// // Video Generation from File
// app.post('/api/generate/video/file', authenticateAPI, upload.single('sourceFile'), async (req, res) => {
//     const userId = req.user.id; // Guaranteed by authenticateAPI

//     if (!req.file) {
//         return res.status(400).json({ success: false, msg: 'No file uploaded.' });
//     }

//     const inputFile = req.file.path;
//     const outputFileName = `video_${Date.now()}_${userId}.mp4`;
//     const outputPath = path.join(__dirname, 'storage', 'videos', outputFileName);

//     const newContent = new GeneratedContent({
//         userId,
//         type: 'video',
//         prompt: `Video from file: ${req.file.originalname}`,
//         filePath: `storage/videos/${outputFileName}`,
//         status: 'pending'
//     });
//     await newContent.save();

//     res.status(202).json({ success: true, msg: 'Video generation from file started. Check gallery soon.', contentId: newContent._id });

//     const ffmpegArgs = [
//         '-loop', '1',
//         '-i', inputFile,
//         '-c:v', 'libx264',
//         '-t', '5',
//         '-pix_fmt', 'yuv420p',
//         '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
//         outputPath
//     ];

//     const FFMPEG_NODE_PATH = "C:\\ffmpeg\\ffmpeg-master-latest-win64-gpl\\bin\\ffmpeg.exe";
//     const ffmpegProcess = spawn(FFMPEG_NODE_PATH, ffmpegArgs);

//     let ffmpegErrorOutput = '';
//     ffmpegProcess.stderr.on('data', (data) => { ffmpegErrorOutput += data.toString(); });

//     ffmpegProcess.on('close', async (code) => {
//         fs.unlink(inputFile, (unlinkErr) => {
//             if (unlinkErr) console.error('Error deleting temp upload file:', unlinkErr);
//         });

//         if (code === 0) {
//             newContent.status = 'completed';
//             await newContent.save();
//             console.log(`Video generated for ${userId}: ${outputPath}`);
//         } else {
//             newContent.status = 'failed';
//             await newContent.save();
//             console.error(`FFmpeg video generation failed for ${userId}: Code ${code}, Error: ${ffmpegErrorOutput}`);
//         }
//     });
// });

// // Get User Gallery Data
// app.get('/api/gallery', authenticateAPI, async (req, res) => {
//     try {
//         const galleryItems = await GeneratedContent.find({ userId: req.user.id }).sort({ createdAt: -1 });
//         res.json({ success: true, gallery: galleryItems });
//     } catch (err) {
//         console.error(err.message);
//         res.status(500).json({ success: false, msg: 'Server error fetching gallery' });
//     }
// });

// // Start the server
// app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));





