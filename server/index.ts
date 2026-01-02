import express from 'express';
import cors from 'cors';
import { codeService } from '../services/codeService';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

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

        const data = await codeService.getDiff(fromIndex, toIndex)
        res.json(data);
    } catch (error) {
        res.status(404).json({ error: (error as Error).message });
    }
});

app.get('/api/code/:index', async (req, res) => {
    try {
        const index = parseInt(req.params.index);
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});