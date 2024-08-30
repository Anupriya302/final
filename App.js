import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css'; // Import the CSS file

function App() {
    const [expenses, setExpenses] = useState([]);
    const [title, setTitle] = useState('');
    const [amount, setAmount] = useState('');
    const [category, setCategory] = useState('');
    const [date, setDate] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        fetchExpenses();
    }, []);

    const fetchExpenses = async () => {
        const response = await axios.get('http://localhost:5000/expenses');
        setExpenses(response.data);
    };

    const addExpense = async () => {
        const newExpense = { title, amount, category, date };
        if (editingId) {
            await axios.put(`http://localhost:5000/expenses/${editingId}`, newExpense);
            setEditingId(null);
        } else {
            await axios.post('http://localhost:5000/expenses', newExpense);
        }
        fetchExpenses();
        setTitle('');
        setAmount('');
        setCategory('');
        setDate('');
    };

    const deleteExpense = async (id) => {
        await axios.delete(`http://localhost:5000/expenses/${id}`);
        fetchExpenses();
    };

    const editExpense = (expense) => {
        setTitle(expense.title);
        setAmount(expense.amount);
        setCategory(expense.category);
        setDate(expense.date);
        setEditingId(expense._id);
    };

    const filteredExpenses = expenses.filter(expense =>
        expense.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        expense.category.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const getTotalExpenses = () => {
        return expenses.reduce((total, expense) => total + parseFloat(expense.amount), 0);
    };

    return (
        <div className="App">
            <h1>Expense Tracker</h1>
            <div className="form-container">
                <input 
                    type="text" 
                    placeholder="Title" 
                    value={title} 
                    onChange={(e) => setTitle(e.target.value)} 
                />
                <input 
                    type="number" 
                    placeholder="Amount" 
                    value={amount} 
                    onChange={(e) => setAmount(e.target.value)} 
                />
                <input 
                    type="text" 
                    placeholder="Category" 
                    value={category} 
                    onChange={(e) => setCategory(e.target.value)} 
                />
                <input 
                    type="date" 
                    value={date} 
                    onChange={(e) => setDate(e.target.value)} 
                />
                <button onClick={addExpense}>{editingId ? 'Update' : 'Add'} Expense</button>
            </div>
            <div className="search-container">
                <input 
                    type="text" 
                    placeholder="Search expenses" 
                    value={searchTerm} 
                    onChange={(e) => setSearchTerm(e.target.value)} 
                />
            </div>
            <ul>
                {filteredExpenses.map(expense => (
                    <li key={expense._id}>
                        {expense.title} - {expense.amount} - {expense.category} - {expense.date}
                        <button onClick={() => editExpense(expense)}>Edit</button>
                        <button onClick={() => deleteExpense(expense._id)}>Delete</button>
                    </li>
                ))}
            </ul>
            <div className="summary">
                <h2>Total Expenses: ${getTotalExpenses()}</h2>
            </div>
        </div>
    );
}

export default App;
