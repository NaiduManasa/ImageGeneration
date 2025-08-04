// models/GeneratedContent.js
const mongoose = require('mongoose');

const GeneratedContentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['image', 'video'],
        required: true
    },
    prompt: {
        type: String,
        // Optional for file-to-video, so remove 'required: true'
        // If you always want a prompt, you'd need to ensure it's provided
        // or set a default like 'N/A' before saving if not from user input.
        // For now, let's just make it always optional here to avoid validation errors
        // if a prompt isn't strictly provided for file-based generation.
    },
    filePath: { // Path or URL to the generated file
        type: String,
        // REMOVE 'required: true' here
        // The path will be added AFTER generation completes
    },
    thumbnailPath: { // Optional: for videos, a path to a generated thumbnail image
        type: String
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'pending'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('GeneratedContent', GeneratedContentSchema);



