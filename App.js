const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const schedule = require('node-schedule');
const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;
const rateLimit = require('express-rate-limit');

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(cors());

// Rate Limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: "Too many requests from this IP, please try again later."
});
app.use(apiLimiter);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'default_jwt_secret';


// Connect to MongoDB
mongoose.connect('mongodb://localhost/expense_tracker', { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log(err));

// User Schema
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    currency: { type: String, default: 'USD' },
    budget: { type: Number, default: 0 },
    googleId: { type: String }
});

UserSchema.pre('save', async function(next) {
    const user = this;
    if (user.isModified('password') || user.isNew) {
        user.password = await bcrypt.hash(user.password, 10);
    }
    next();
});

const User = mongoose.model('User', UserSchema);

// Middleware to authenticate requests
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.sendStatus(401);

    const token = authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// Expense Schema
const ExpenseSchema = new mongoose.Schema({
    title: String,
    amount: Number,
    category: String,
    date: { type: Date, default: Date.now },
    tags: [String],
    note: String,
    attachment: String,
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    currency: { type: String, default: 'USD' },
    recurring: { type: Boolean, default: false },
    nextOccurrence: Date,
});

const Expense = mongoose.model('Expense', ExpenseSchema);

// Authentication Routes
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const user = new User({ username, password });
    try {
        await user.save();
        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (err) {
        res.status(400).json({ error: 'Username already exists' });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
});

// Google OAuth Integration (for login)
app.get('/auth/google', (req, res) => {
    const oauth2Client = new OAuth2(
        'YOUR_CLIENT_ID',
        'YOUR_CLIENT_SECRET',
        'YOUR_REDIRECT_URL'
    );

    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['profile', 'email']
    });

    res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
    const oauth2Client = new OAuth2(
        'YOUR_CLIENT_ID',
        'YOUR_CLIENT_SECRET',
        'YOUR_REDIRECT_URL'
    );

    const { tokens } = await oauth2Client.getToken(req.query.code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2('v2').userinfo;
    const userInfo = await oauth2.get({ auth: oauth2Client });
    const { email, name } = userInfo.data;

    let user = await User.findOne({ googleId: email });
    if (!user) {
        user = new User({ username: email, googleId: email });
        await user.save();
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// File Upload Configuration
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});


// Email Configuration
const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: 'your-email@gmail.com',
        pass: 'your-email-password'
    }
});

// Expense Routes
app.get('/expenses', authenticateToken, async (req, res) => {
    try {
        const expenses = await Expense.find({ userId: req.user.userId });
        res.json(expenses);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch expenses' });
    }
});

app.post('/expenses', authenticateToken, upload.single('attachment'), async (req, res) => {
    const { title, amount, category, tags, note, recurring, nextOccurrence, currency } = req.body;
    const newExpense = new Expense({
        title,
        amount,
        category,
        tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
        note,
        attachment: req.file ? req.file.filename : null,
        userId: req.user.userId,
        recurring,
        nextOccurrence: recurring ? new Date(nextOccurrence) : null,
        currency: currency || req.user.currency,
    });

    try {
        await newExpense.save();
        res.json(newExpense);

        // Schedule next occurrence if recurring
        if (recurring && newExpense.nextOccurrence) {
            schedule.scheduleJob(newExpense.nextOccurrence, async () => {
                const newRecurringExpense = new Expense({
                    ...newExpense.toObject(),
                    date: new Date(),
                    nextOccurrence: new Date(newExpense.nextOccurrence.setMonth(newExpense.nextOccurrence.getMonth() + 1)),
                });
                await newRecurringExpense.save();
                console.log('Scheduled recurring expense created:', newRecurringExpense);

                // Send email notification
                const mailOptions = {
                    from: 'your-email@gmail.com',
                    to: 'user-email@gmail.com', // You can use req.user.email or another method to get the user's email
                    subject: 'Recurring Expense Created',
                    text: `A new recurring expense has been created: ${newRecurringExpense.title}`
                };
                transporter.sendMail(mailOptions, (error, info) => {
                    if (error) console.error('Failed to send email:', error);
                    else console.log('Email sent:', info.response);
                });
            });
        }
    } catch (err) {
        res.status(400).json({ error: 'Failed to create expense' });
    }
});

app.put('/expenses/:id', authenticateToken, async (req, res) => {
    const { title, amount, category, tags, note, currency } = req.body;
    try {
        const updatedExpense = await Expense.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.userId },
            { 
                title, 
                amount, 
                category, 
                tags: tags ? tags.split(',').map(tag => tag.trim()) : [], 
                note, 
                currency: currency || req.user.currency 
            },
            { new: true }
        );
        if (!updatedExpense) {
            return res.status(404).json({ error: 'Expense not found' });
        }
        res.json(updatedExpense);
    } catch (err) {
        res.status(400).json({ error: 'Failed to update expense' });
    }
});

app.delete('/expenses/:id', authenticateToken, async (req, res) => {
    try {
        const deletedExpense = await Expense.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
        if (!deletedExpense) {
            return res.status(404).json({ error: 'Expense not found' });
        }

        // Optionally, delete the attachment file
        if (deletedExpense.attachment) {
            const filePath = path.join(__dirname, 'uploads', deletedExpense.attachment);
            fs.unlink(filePath, (err) => {
                if (err) console.error('Failed to delete attachment:', err);
            });
        }
        res.json({ message: 'Expense deleted' });
    } catch (err) {
        res.status(400).json({ error: 'Failed to delete expense' });
    }
});

// Search and Filter Routes
app.get('/expenses/search', authenticateToken, async (req, res) => {
    const { query } = req.query;
    try {
        const expenses = await Expense.find({
            userId: req.user.userId,
            $or: [
                { title: { $regex: query, $options: 'i' } },
                { note: { $regex: query, $options: 'i' } }
            ]
        });
        res.json(expenses);
    } catch (err) {
        res.status(500).json({ error: 'Failed to search expenses' });
    }
});

app.get('/expenses/filter', authenticateToken, async (req, res) => {
    const { startDate, endDate, category } = req.query;
    const query = { userId: req.user.userId };

    if (startDate || endDate) {
        query.date = {};
        if (startDate) query.date.$gte = new Date(startDate);
        if (endDate) query.date.$lte = new Date(endDate);
    }

    if (category) {
        query.category = category;
    }

    try {
        const expenses = await Expense.find(query);
        res.json(expenses);
    } catch (err) {
        res.status(500).json({ error: 'Failed to filter expenses' });
    }
});

// Generate Report (CSV Example)
app.get('/report', authenticateToken, async (req, res) => {
    try {
        const expenses = await Expense.find({ userId: req.user.userId });
        let csv = 'Title,Amount,Category,Date,Tags,Note,Currency\n';
        expenses.forEach(expense => {
            csv += `"${expense.title.replace(/"/g, '""')}",${expense.amount},"${expense.category.replace(/"/g, '""')}",${expense.date.toISOString()},"${expense.tags.join('|').replace(/"/g, '""')}",${expense.note ? `"${expense.note.replace(/"/g, '""')}"` : ''},${expense.currency}\n`;
        });

        res.header('Content-Type', 'text/csv');
        res.attachment('expenses-report.csv');
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// Forecasting Expenses (Example - Basic)
app.get('/expenses/forecast', authenticateToken, async (req, res) => {
    try {
        const expenses = await Expense.find({ userId: req.user.userId });
        const forecast = {}; // Simple forecasting logic can be implemented here

        // Example: Calculate average monthly spending
        let totalAmount = 0;
        let totalCount = 0;
        expenses.forEach(expense => {
            totalAmount += expense.amount;
            totalCount++;
        });

        const average = totalCount > 0 ? totalAmount / totalCount : 0;
        res.json({ average });
    } catch (err) {
        res.status(500).json({ error: 'Failed to forecast expenses' });
    }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
