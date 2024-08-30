const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(cors());

// Connect to MongoDB
mongoose.connect('mongodb://localhost/expense_tracker', { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log(err));

// Expense Schema
const ExpenseSchema = new mongoose.Schema({
    title: String,
    amount: Number,
    category: String,
    date: { type: Date, default: Date.now }
});

const Expense = mongoose.model('Expense', ExpenseSchema);

// API Routes
app.get('/expenses', async (req, res) => {
    const expenses = await Expense.find();
    res.json(expenses);
});

app.post('/expenses', async (req, res) => {
    const newExpense = new Expense(req.body);
    await newExpense.save();
    res.json(newExpense);
});

app.put('/expenses/:id', async (req, res) => {
    const updatedExpense = await Expense.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updatedExpense);
});

app.delete('/expenses/:id', async (req, res) => {
    await Expense.findByIdAndDelete(req.params.id);
    res.json({ message: 'Expense deleted' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
