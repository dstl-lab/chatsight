import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import express from 'express';
import cors from 'cors';
import { InferenceClient } from '@huggingface/inference';
import { dumpCleanedContentIntoFile } from '../services/cleanedImport';
import { codeService } from '../services/codeService';
import { fileService } from '../services/fileService';

// Load .env from project root (parent of server/)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = 3000;
const FILE_PARSER_URL = process.env.FILE_PARSER_URL ?? 'http://localhost:8000';
const HUGGING_FACE_TOKEN = process.env.HUGGING_FACE_TOKEN;
const hf = HUGGING_FACE_TOKEN ? new InferenceClient(HUGGING_FACE_TOKEN) : null;

const ALLOWED_FILE_EXTENSIONS = ['txt'];
function sanitizeFilename(filename: string): string {
    const parts = filename.split('.');
    const extension = parts.length > 1 ? parts.pop() || '' : '';
    const nameWithoutExt = parts.join('.');

    let sanitized = nameWithoutExt
        .replace(/[\/\\:*?"<>|]/g, '')
        .replace(/^[.\s]+/, '')
        .replace(/[.\s]+$/, '');
    
    if (sanitized.length > 255) {
        const maxNameLength = extension ? 255 - extension.length - 1 : 255;
        sanitized = sanitized.substring(0, Math.max(0, maxNameLength));
    }
    
    const finalName = sanitized || 'untitled';
    return extension ? `${finalName}.${extension}` : finalName;
}

function getFileExtension(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

function isFileTypeAllowed(filename: string): { allowed: boolean; reason?: string } {
    const extension = getFileExtension(filename);

    if (!extension) {
        return { allowed: false, reason: 'File must have an extension' };
    }

    if (!ALLOWED_FILE_EXTENSIONS.includes(extension)) {
        return {
            allowed: false,
            reason: `File type .${extension} is not allowed. Allowed types: ${ALLOWED_FILE_EXTENSIONS.join(', ')}`
        };
    }
    
    return { allowed: true };
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
    res.json({ message: 'Code Service API is running', endpoints: ['/api/code/:index', '/api/code/diff?from=X&to=Y', 'POST /api/code'] });
});

app.get('/api/code/diff', async (req, res) => {
    try {
        const fromStr = req.query.from as string;
        const toStr = req.query.to as string;

        if (!fromStr || !toStr) {
            return res.status(400).json({
                error: 'Missing required query parameters: from and to'
            });
        }

        const fromIndex = parseInt(fromStr, 10);
        const toIndex = parseInt(toStr, 10);

        if (isNaN(fromIndex) || isNaN(toIndex)) {
            return res.status(400).json({
                error: `Invalid query parameters: from=${fromStr}, to=${toStr}`
            });
        }

        const data = await codeService.getDiff(fromIndex, toIndex);
        res.json(data);
    } catch (error) {
        res.status(404).json({ error: (error as Error).message });
    }
});

app.get('/api/code/:index', async (req, res) => {
    try {
        const index = parseInt(req.params.index, 10);

        if (isNaN(index) || index < 0) {
            return res.status(400).json({ 
                error: `Invalid code index: ${req.params.index}. Must be a non-negative integer.` 
            });
        }

        const data = await codeService.getCode(index);
        res.json(data);
    } catch (error) {
        res.status(404).json({ error: (error as Error).message });
    }
});

app.post('/api/code', async (req, res) => {
    try {
        const { messageIndex, codeContent } = req.body;
        await codeService.saveCode(messageIndex, codeContent);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.post('/api/files', async (req, res) => {
    try {
        const { filename, content, fileType } = req.body;

        if (!filename || !content) {
            return res.status(400).json({ error: 'Filename and content are required' });
        }

        const validation = isFileTypeAllowed(filename);
        if (!validation.allowed) {
            return res.status(400).json({
                error: validation.reason || 'File type not allowed'
            });
        }

        const sanitizedFilename = sanitizeFilename(filename);
        const MAX_FILE_SIZE = 10 * 1024 * 1024;
        const actualFileSize = Buffer.byteLength(content, 'utf8');
        
        if (actualFileSize > MAX_FILE_SIZE) {
            return res.status(400).json({
                error: `File size (${(actualFileSize / 1024 / 1024).toFixed(2)} MB) exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`
            });
        }

        let contentToSave = content;
        if (getFileExtension(filename) === 'txt') {
            try {
                const r = await fetch(`${FILE_PARSER_URL}/api/v1/standardize-txt`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content }),
                });
                if (r.ok) {
                    const { content: standardized } = (await r.json()) as { content: string };
                    contentToSave = standardized;
                }
            } catch (standardizationError) {
                console.error('Text standardization failed; saving original content instead:', standardizationError);
            }
        }

        const fileData = await fileService.saveFile(sanitizedFilename, contentToSave, fileType, Buffer.byteLength(contentToSave, 'utf8'));

        if (getFileExtension(filename) === 'txt') {
            try {
                dumpCleanedContentIntoFile(fileData.id, contentToSave);
            } catch (dumpError) {
                console.warn(
                    'Dump cleaned data into DB failed (file saved):', 
                    { fileId: fileData.id, filename: sanitizedFilename, error: dumpError }
                );
            }
        }

        res.json(fileData);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.get('/api/files', async (req, res) => {
    try {
        const files = await fileService.getAllFiles();
        res.json(files);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.get('/api/files/:id/messages', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: `Invalid file id: ${req.params.id}. Must be a positive integer.` });
        }
        const messages = await fileService.getFileMessages(id);
        res.json(messages);
    } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('not found')) {
            res.status(404).json({ error: errorMessage });
        } else {
            res.status(500).json({ error: errorMessage });
        }
    }
});

app.get('/api/files/:id/assignments', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: `Invalid file id: ${req.params.id}. Must be a positive integer.` });
        }
        const assignments = await fileService.getFileAssignments(id);
        res.json(assignments);
    } catch (error) {
        const errorMessage = (error as Error).message;
        res.status(errorMessage.includes('not found') ? 404 : 500).json({ error: errorMessage });
    }
});

app.get('/api/assignments/:id/conversations', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: `Invalid assignment id: ${req.params.id}. Must be a positive integer.` });
        }
        const conversations = await fileService.getAssignmentConversations(id);
        res.json(conversations);
    } catch (error) {
        const errorMessage = (error as Error).message;
        res.status(errorMessage.includes('not found') ? 404 : 500).json({ error: errorMessage });
    }
});

app.get('/api/conversations/:id/messages', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: `Invalid conversation id: ${req.params.id}. Must be a positive integer.` });
        }
        const messages = await fileService.getConversationMessages(id);
        res.json(messages);
    } catch (error) {
        const errorMessage = (error as Error).message;
        res.status(errorMessage.includes('not found') ? 404 : 500).json({ error: errorMessage });
    }
});

app.get('/api/files/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);

        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ 
                error: `Invalid file id: ${req.params.id}. Must be a positive integer.` 
            });
        }

        const file = await fileService.getFile(id);
        res.json(file);
    } catch (error) {
        const errorMessage = (error as Error).message;
        
        if (errorMessage.includes('not found')) {
            res.status(404).json({ error: errorMessage });
        } else {
            console.error('Error fetching file:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

app.delete('/api/files/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);

        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ 
                error: `Invalid file id: ${req.params.id}. Must be a positive integer.` 
            });
        }

        await fileService.deleteFile(id);
        res.json({ success: true });
    } catch (error) {
        const errorMessage = (error as Error).message;
        
        if (errorMessage.includes('not found')) {
            res.status(404).json({ error: errorMessage });
        } else {
            console.error('Error fetching file:', error);
            res.status(500).json({ error: 'Internal server error' });
        }    }
});

app.post('/api/sentiment', async (req, res) => {
    if (!hf) {
        return res.status(503).json({ error: 'Sentiment analysis not configured (missing HUGGING_FACE_TOKEN)' });
    }
    try {
        const { sentences } = req.body as { sentences?: string[] };
        if (!Array.isArray(sentences) || sentences.length === 0) {
            return res.status(400).json({ error: 'Request body must include a non-empty array: sentences' });
        }
        const SENTIMENT_MODEL = 'j-hartmann/emotion-english-distilroberta-base';
        // Model max length is 512 tokens; ~4 chars/token → truncate to stay under
        const MAX_INPUT_CHARS = 500;
        const truncate = (s: string) =>
            s.length <= MAX_INPUT_CHARS ? s : s.slice(0, MAX_INPUT_CHARS).trim();
        const results = await Promise.all(
            sentences.map(async (sentence: string) => {
                const input = truncate(sentence);
                const output = await hf.textClassification({
                    model: SENTIMENT_MODEL,
                    inputs: input,
                });
                return { sentence, sentiment: output };
            })
        );
        res.json(results);
    } catch (error) {
        console.error('Sentiment API error:', error);
        res.status(500).json({ error: (error as Error).message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`HUGGING_FACE_TOKEN: ${HUGGING_FACE_TOKEN ? 'set' : 'NOT SET'}`);
});